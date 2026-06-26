//! Per-server lifecycle supervisor. This is the single source of truth for a
//! server's state. One supervisor thread is spawned per started (or adopted)
//! server. It:
//!   * watches the child process for exit (authoritative up/down),
//!   * probes the server port to detect "finished loading / accepting players"
//!     (the universal online signal, replacing console-log scraping),
//!   * collects a telemetry sample (SLP + sysinfo + RCON) on a cadence,
//!     persists it to the time-series store, and
//!   * emits `server-runtime-state` and `server-telemetry` events.
//!
//! The frontend is a pure consumer of these events plus a one-shot snapshot.

use super::super::{
    LifecycleState, RconConfig, ServerRuntime, ServerRuntimeStateEvent, ServerTelemetryEvent,
    TelemetrySample, TpsCommandState,
};
use super::rcon::RconClient;
use super::telemetry::{
    StatusPingResult, collect_status_ping, collect_tps_via_rcon, probe_port,
    refresh_process_metrics,
};
use super::telemetry_store;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use sysinfo::System;
use tauri::Emitter;

static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

/// A monotonically increasing token stamped on each runtime when it starts. A
/// supervisor exits as soon as its runtime's generation no longer matches, so a
/// restart can never leave two supervisors fighting over one server.
pub(in crate::app) fn next_generation() -> u64 {
    NEXT_GENERATION.fetch_add(1, Ordering::Relaxed)
}

const PROBE_TIMEOUT: Duration = Duration::from_millis(700);
const PING_TIMEOUT: Duration = Duration::from_millis(700);
const STARTING_POLL: Duration = Duration::from_millis(1000);
const ONLINE_POLL: Duration = Duration::from_millis(5000);
/// Consecutive failed probes before an adopted (external) server is declared off.
const EXTERNAL_OFFLINE_STREAK: u32 = 3;
/// How long to wait for a graceful `stop` before force-killing the process.
const STOP_GRACE: Duration = Duration::from_secs(10);

struct Snapshot {
    directory: String,
    state: LifecycleState,
    pid: Option<u32>,
    has_child: bool,
    host: String,
    server_port: u16,
    rcon: Option<RconConfig>,
    is_proxy: bool,
    server_id: String,
    configured_ram: Option<f64>,
    provider_version: Option<String>,
    started_at: chrono::DateTime<chrono::Utc>,
    tps_state: TpsCommandState,
}

enum Phase1 {
    Stop,
    Terminal(ServerRuntimeStateEvent),
    Continue(Snapshot),
}

fn state_event(runtime: &ServerRuntime) -> ServerRuntimeStateEvent {
    ServerRuntimeStateEvent {
        directory: runtime.directory.clone(),
        state: runtime.state,
        pid: runtime.pid,
        started_at: Some(runtime.started_at.to_rfc3339()),
        exit_code: runtime.exit_code,
        stderr_tail: runtime.stderr_tail.iter().cloned().collect(),
        server_port: None,
    }
}

/// Outcome of deciding the next lifecycle state for one poll cycle.
struct StateDecision {
    state: LifecycleState,
    /// The running streak of failed probes for an adopted server (0 once it is
    /// confirmed up by either an owned child or an accepting port).
    miss_streak: u32,
    /// True when an adopted server has missed enough probes to be declared off,
    /// at which point the supervisor should exit.
    external_terminal: bool,
}

/// Pure lifecycle transition for one poll cycle. Given the previous state,
/// whether we own the child process, whether the port is accepting, and the
/// running streak of failed probes for an adopted server, decide the next state.
///
/// Extracted from the supervisor loop so every transition is unit-testable
/// without spawning threads or sockets. The supervisor loop is a thin driver
/// around this function plus I/O.
fn next_state(
    prev: LifecycleState,
    has_child: bool,
    accepting: bool,
    external_miss_streak: u32,
) -> StateDecision {
    if has_child {
        // We own the process, so up/down comes from the child, not the port.
        // The only port-driven transition is starting -> online once it binds.
        let state = match prev {
            LifecycleState::Starting if accepting => LifecycleState::Online,
            other => other,
        };
        StateDecision {
            state,
            miss_streak: 0,
            external_terminal: false,
        }
    } else if accepting {
        // No owned child but the port answers: an externally-started server.
        StateDecision {
            state: LifecycleState::RunningExternal,
            miss_streak: 0,
            external_terminal: false,
        }
    } else {
        // Adopted server not answering: count the miss and give up after a streak.
        let miss_streak = external_miss_streak + 1;
        if miss_streak >= EXTERNAL_OFFLINE_STREAK {
            StateDecision {
                state: LifecycleState::Offline,
                miss_streak,
                external_terminal: true,
            }
        } else {
            StateDecision {
                state: prev,
                miss_streak,
                external_terminal: false,
            }
        }
    }
}

pub(in crate::app) fn spawn_supervisor(
    processes: Arc<Mutex<HashMap<String, ServerRuntime>>>,
    app: tauri::AppHandle,
    key: String,
    generation: u64,
) {
    std::thread::spawn(move || {
        let mut system = System::new();
        let mut external_miss_streak: u32 = 0;
        // Persistent RCON connection for TPS, reused across polls so we don't
        // reconnect (and spam the server log with connect/disconnect) every cycle.
        let mut rcon_client: Option<RconClient> = None;

        loop {
            // ---- Phase 1: brief lock — read a snapshot and detect process exit.
            let phase1 = {
                let Ok(mut guard) = processes.lock() else {
                    return;
                };

                match guard.get_mut(&key) {
                    None => Phase1::Stop,
                    Some(runtime) if runtime.generation != generation => Phase1::Stop,
                    Some(runtime) => {
                        // Capture the exit status first so the mutable borrow of
                        // `runtime.child` is released before we mutate `runtime`.
                        let exited = runtime
                            .child
                            .as_mut()
                            .and_then(|child| child.try_wait().ok().flatten());

                        if let Some(status) = exited {
                            let code = status.code();
                            let requested =
                                runtime.stop_requested || runtime.state == LifecycleState::Stopping;
                            runtime.state = if requested || code == Some(0) {
                                LifecycleState::Offline
                            } else {
                                LifecycleState::Crashed
                            };
                            runtime.exit_code = code;
                            runtime.child = None;
                            runtime.stdin = None;
                            runtime.pid = None;
                            runtime.latest_sample = None;
                            Phase1::Terminal(state_event(runtime))
                        } else {
                            // Escalate a graceful stop that has overstayed its grace.
                            if runtime.stop_requested
                                && runtime
                                    .stop_requested_at
                                    .is_some_and(|at| at.elapsed() >= STOP_GRACE)
                                && let Some(child) = runtime.child.as_mut()
                            {
                                let _ = child.kill();
                            }
                            Phase1::Continue(Snapshot {
                                directory: runtime.directory.clone(),
                                state: runtime.state,
                                pid: runtime.pid,
                                has_child: runtime.child.is_some(),
                                host: runtime.host.clone(),
                                server_port: runtime.server_port,
                                rcon: runtime.rcon.clone(),
                                is_proxy: runtime.is_proxy,
                                server_id: runtime.server_id.clone(),
                                configured_ram: runtime.configured_ram,
                                provider_version: runtime.provider_version.clone(),
                                started_at: runtime.started_at,
                                tps_state: runtime.tps_state,
                            })
                        }
                    }
                }
            };

            let snapshot = match phase1 {
                Phase1::Stop => return,
                Phase1::Terminal(event) => {
                    let _ = app.emit("server-runtime-state", event);
                    return;
                }
                Phase1::Continue(snapshot) => snapshot,
            };

            // ---- Phase 2: slow work without the lock — probe + sample.
            let accepting = probe_port(&snapshot.host, snapshot.server_port, PROBE_TIMEOUT);
            let status: StatusPingResult = if accepting {
                collect_status_ping(&snapshot.host, snapshot.server_port, PING_TIMEOUT)
            } else {
                StatusPingResult::default()
            };

            let decision = next_state(
                snapshot.state,
                snapshot.has_child,
                accepting,
                external_miss_streak,
            );
            external_miss_streak = decision.miss_streak;
            let new_state = decision.state;
            let external_terminal = decision.external_terminal;

            let online_now = matches!(
                new_state,
                LifecycleState::Online | LifecycleState::RunningExternal
            );

            let mut local_tps_state = snapshot.tps_state;
            let sample = if online_now {
                let tps = if snapshot.is_proxy {
                    None
                } else {
                    snapshot.rcon.as_ref().and_then(|rcon| {
                        collect_tps_via_rcon(
                            &snapshot.host,
                            rcon,
                            &mut local_tps_state,
                            &mut rcon_client,
                        )
                    })
                };

                let metrics = snapshot
                    .pid
                    .map(|pid| refresh_process_metrics(&mut system, pid, snapshot.configured_ram))
                    .unwrap_or_default();

                Some(TelemetrySample {
                    timestamp: chrono::Utc::now().timestamp_millis(),
                    online: true,
                    players_online: status.players_online,
                    players_max: status.players_max,
                    server_version: status.server_version.clone(),
                    provider_version: snapshot.provider_version.clone(),
                    tps,
                    ram_used: metrics.ram_used,
                    ram_bytes: metrics.ram_bytes,
                    cpu_used: metrics.cpu_used,
                    uptime: Some(snapshot.started_at.to_rfc3339()),
                })
            } else {
                None
            };

            // ---- Phase 3: brief lock — write back state/sample, prepare events.
            let mut state_change: Option<ServerRuntimeStateEvent> = None;
            {
                let Ok(mut guard) = processes.lock() else {
                    return;
                };
                let Some(runtime) = guard.get_mut(&key) else {
                    return;
                };
                if runtime.generation != generation {
                    return;
                }

                runtime.tps_state = local_tps_state;
                if let Some(ref sample) = sample {
                    runtime.latest_sample = Some(sample.clone());
                }
                if runtime.state != new_state {
                    runtime.state = new_state;
                    state_change = Some(state_event(runtime));
                }
            }

            if let Some(sample) = sample {
                telemetry_store::insert_sample(&snapshot.server_id, &sample);
                let _ = app.emit(
                    "server-telemetry",
                    ServerTelemetryEvent {
                        directory: snapshot.directory.clone(),
                        sample,
                    },
                );
            }
            if let Some(event) = state_change {
                let _ = app.emit("server-runtime-state", event);
            }

            if external_terminal {
                return;
            }

            std::thread::sleep(match new_state {
                LifecycleState::Online | LifecycleState::RunningExternal => ONLINE_POLL,
                _ => STARTING_POLL,
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owned_starting_goes_online_when_port_accepts() {
        let d = next_state(LifecycleState::Starting, true, true, 0);
        assert_eq!(d.state, LifecycleState::Online);
        assert_eq!(d.miss_streak, 0);
        assert!(!d.external_terminal);
    }

    #[test]
    fn owned_starting_stays_starting_until_port_accepts() {
        let d = next_state(LifecycleState::Starting, true, false, 0);
        assert_eq!(d.state, LifecycleState::Starting);
        assert!(!d.external_terminal);
    }

    #[test]
    fn owned_online_stays_online_even_if_probe_misses() {
        // With an owned child, up/down is the child's job, not the port probe — a
        // transient probe miss must not knock a running server offline.
        let d = next_state(LifecycleState::Online, true, false, 0);
        assert_eq!(d.state, LifecycleState::Online);
        assert!(!d.external_terminal);
    }

    #[test]
    fn no_child_accepting_is_adopted_as_external() {
        let d = next_state(LifecycleState::Offline, false, true, 2);
        assert_eq!(d.state, LifecycleState::RunningExternal);
        // A successful probe resets the miss streak.
        assert_eq!(d.miss_streak, 0);
        assert!(!d.external_terminal);
    }

    #[test]
    fn external_miss_streak_counts_up_without_giving_up_early() {
        let d = next_state(LifecycleState::RunningExternal, false, false, 0);
        assert_eq!(d.state, LifecycleState::RunningExternal);
        assert_eq!(d.miss_streak, 1);
        assert!(!d.external_terminal);
    }

    #[test]
    fn external_goes_offline_and_terminal_after_streak() {
        // EXTERNAL_OFFLINE_STREAK consecutive misses declares the adopted server
        // off and signals the supervisor to exit.
        let d = next_state(
            LifecycleState::RunningExternal,
            false,
            false,
            EXTERNAL_OFFLINE_STREAK - 1,
        );
        assert_eq!(d.state, LifecycleState::Offline);
        assert_eq!(d.miss_streak, EXTERNAL_OFFLINE_STREAK);
        assert!(d.external_terminal);
    }
}
