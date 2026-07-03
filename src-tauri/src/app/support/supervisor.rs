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
    LifecycleState, RconConfig, ServerOutputEvent, ServerRuntime, ServerRuntimeStateEvent,
    ServerTelemetryEvent, TelemetrySample, TpsCommandState,
};
use super::playit;
use super::rcon::RconClient;
use super::runtime_io::send_stop_via_stdin;
use super::sleep_listener::{SleepListenerParams, spawn_sleep_listener};
use super::telemetry::{
    StatusPingResult, collect_process_metrics, collect_status_ping, collect_tps_via_rcon,
    probe_port,
};
use super::telemetry_store;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

/// How long to wait before a backend-initiated crash restart, so a server that
/// dies instantly on boot doesn't spin the CPU.
const AUTO_RESTART_BACKOFF: Duration = Duration::from_secs(5);
/// Sliding window over which crash restarts are counted for the loop guard.
const RESTART_WINDOW: Duration = Duration::from_secs(600);
/// Max crash restarts allowed within `RESTART_WINDOW` before we give up and
/// leave the server `crashed` for the user to deal with.
const MAX_RESTARTS_IN_WINDOW: usize = 3;

/// Per-server (by runtime key) timestamps of recent backend auto-restarts, used
/// to detect a crash loop and stop retrying. Pruned to `RESTART_WINDOW` on read.
static RESTART_HISTORY: Mutex<Option<HashMap<String, VecDeque<Instant>>>> = Mutex::new(None);

/// Counts backend auto-restarts recorded for `key` within the sliding window,
/// pruning older entries. Does not record a new attempt.
fn recent_restart_count(key: &str) -> usize {
    let Ok(mut guard) = RESTART_HISTORY.lock() else {
        return 0;
    };
    let map = guard.get_or_insert_with(HashMap::new);
    let now = Instant::now();
    let dq = map.entry(key.to_string()).or_default();
    while let Some(&front) = dq.front() {
        if now.duration_since(front) > RESTART_WINDOW {
            dq.pop_front();
        } else {
            break;
        }
    }
    dq.len()
}

/// Records a backend auto-restart attempt for `key` at the current instant.
fn record_restart(key: &str) {
    let Ok(mut guard) = RESTART_HISTORY.lock() else {
        return;
    };
    let map = guard.get_or_insert_with(HashMap::new);
    map.entry(key.to_string())
        .or_default()
        .push_back(Instant::now());
}

/// Pure decision: which terminal state an owned child's exit lands in. A stop we
/// asked for (or a clean exit) is `Offline`; an idle-sleep stop parks in
/// `Sleeping`; anything else is a `Crashed`.
fn terminal_state(
    requested: bool,
    sleep_requested: bool,
    exit_code: Option<i32>,
) -> LifecycleState {
    if sleep_requested {
        LifecycleState::Sleeping
    } else if requested || exit_code == Some(0) {
        LifecycleState::Offline
    } else {
        LifecycleState::Crashed
    }
}

/// Pure decision: should the backend auto-restart this exited server? Restarts
/// apply to any *unrequested* close (crash or clean exit) — matching the old
/// frontend behavior — but only once the run reached `online` (so boot failures
/// like a wrong Java version fall through to the frontend step-down retry) and
/// only while under the crash-loop cap.
fn should_auto_restart(
    auto_restart: bool,
    requested: bool,
    ever_online: bool,
    recent_attempts: usize,
) -> bool {
    auto_restart && !requested && ever_online && recent_attempts < MAX_RESTARTS_IN_WINDOW
}

/// Pure decision: should this poll cycle put the server to sleep? Only an owned,
/// non-proxy, online server with sleep enabled and a confirmed empty player count
/// that has stayed empty at least `threshold` qualifies. A `None` player reading
/// (SLP failed) is treated as "unknown", never "empty", so we never sleep a
/// server we can't prove is idle — the caller resets the idle clock on `None`.
fn should_sleep(
    state: LifecycleState,
    has_child: bool,
    is_proxy: bool,
    sleep_enabled: bool,
    players_online: Option<u32>,
    idle_for: Duration,
    threshold: Duration,
) -> bool {
    matches!(state, LifecycleState::Online)
        && has_child
        && !is_proxy
        && sleep_enabled
        && players_online == Some(0)
        && idle_for >= threshold
}

/// Emits a `server-output` "system" line for a server directory (used to explain
/// backend-driven actions like a crash restart in the console).
fn emit_system_line(app: &tauri::AppHandle, directory: &str, line: impl Into<String>) {
    let _ = app.emit(
        "server-output",
        ServerOutputEvent {
            directory: directory.to_string(),
            stream: "system".to_string(),
            line: line.into(),
        },
    );
}

/// After an owned child exits, decides whether to auto-restart it (crash
/// protection). Runs on the supervisor thread just before it exits, so the
/// restart is spawned on its own short-lived thread after a backoff. When the
/// crash-loop cap is hit, the server is left `crashed` and a note is logged.
fn maybe_auto_restart(
    key: &str,
    outcome: &TerminalOutcome,
    processes: &Arc<Mutex<HashMap<String, ServerRuntime>>>,
    app: &tauri::AppHandle,
) {
    // Only unrequested closes of a server that reached online are candidates.
    if !(outcome.auto_restart && !outcome.requested && outcome.ever_online) {
        return;
    }

    let recent = recent_restart_count(key);
    if !should_auto_restart(
        outcome.auto_restart,
        outcome.requested,
        outcome.ever_online,
        recent,
    ) {
        emit_system_line(
            app,
            &outcome.directory,
            format!(
                "Auto-restart paused after {MAX_RESTARTS_IN_WINDOW} restarts in a short window — start the server manually once the cause is fixed."
            ),
        );
        return;
    }

    record_restart(key);
    let processes = processes.clone();
    let app = app.clone();
    let directory = outcome.directory.clone();
    let java_executable = outcome.java_executable.clone();
    emit_system_line(
        &app.clone(),
        &directory,
        "Server exited unexpectedly — auto-restarting shortly…",
    );
    std::thread::spawn(move || {
        std::thread::sleep(AUTO_RESTART_BACKOFF);
        if let Err(err) = super::super::commands::start_server_internal(
            directory.clone(),
            java_executable,
            processes,
            app.clone(),
        ) {
            emit_system_line(&app, &directory, format!("Auto-restart failed: {err}"));
        }
    });
}

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
    sleep_enabled: bool,
    sleep_idle_minutes: u32,
}

/// A terminal exit of an owned child, carrying both the state event to emit and
/// the inputs the auto-restart decision needs (captured before the entry is
/// dropped from the map).
struct TerminalOutcome {
    event: ServerRuntimeStateEvent,
    directory: String,
    auto_restart: bool,
    requested: bool,
    ever_online: bool,
    java_executable: Option<String>,
}

/// The server exited to enter sleep mode: the map entry is kept and a wake
/// listener is spawned instead of tearing everything down.
struct SleepOutcome {
    event: ServerRuntimeStateEvent,
    params: SleepListenerParams,
}

enum Phase1 {
    Stop,
    Terminal(TerminalOutcome),
    Sleep(SleepOutcome),
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
        server_port: Some(runtime.server_port),
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
        let mut external_miss_streak: u32 = 0;
        // Persistent RCON connection for TPS, reused across polls so we don't
        // reconnect (and spam the server log with connect/disconnect) every cycle.
        let mut rcon_client: Option<RconClient> = None;
        // When the server first went empty (for sleep mode). Reset on any player
        // or an unknown reading; set once players hit zero while online.
        let mut idle_since: Option<Instant> = None;

        loop {
            // ---- Phase 1: brief lock — read a snapshot and detect process exit.
            let phase1 = {
                let Ok(mut guard) = processes.lock() else {
                    return;
                };

                let phase = match guard.get_mut(&key) {
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
                            let sleep_requested = runtime.sleep_requested;
                            let next = terminal_state(requested, sleep_requested, code);
                            runtime.exit_code = code;
                            runtime.child = None;
                            runtime.stdin = None;
                            runtime.pid = None;
                            runtime.latest_sample = None;
                            // Tear the playit tunnel down with the server it fronts.
                            if let Some(stop) = runtime.playit_stop.take() {
                                playit::stop_agent(&stop);
                            }
                            runtime.tunnel_address = None;

                            if matches!(next, LifecycleState::Sleeping) {
                                // Enter sleep: keep the entry, clear the stop flags,
                                // and hand off to a wake listener (spawned below,
                                // outside the lock).
                                runtime.state = LifecycleState::Sleeping;
                                runtime.stop_requested = false;
                                runtime.stop_requested_at = None;
                                runtime.sleep_requested = false;
                                let params = SleepListenerParams {
                                    key: key.clone(),
                                    directory: runtime.directory.clone(),
                                    server_port: runtime.server_port,
                                    motd: runtime.sleep_motd.clone(),
                                    java_executable: runtime.java_executable.clone(),
                                    generation,
                                };
                                Phase1::Sleep(SleepOutcome {
                                    event: state_event(runtime),
                                    params,
                                })
                            } else {
                                runtime.state = next;
                                Phase1::Terminal(TerminalOutcome {
                                    event: state_event(runtime),
                                    directory: runtime.directory.clone(),
                                    auto_restart: runtime.auto_restart,
                                    requested,
                                    ever_online: runtime.ever_online,
                                    java_executable: runtime.java_executable.clone(),
                                })
                            }
                        } else {
                            // Escalate a graceful stop that has overstayed its grace.
                            if runtime.stop_requested
                                && runtime
                                    .stop_requested_at
                                    .is_some_and(|at| at.elapsed() >= STOP_GRACE)
                                && let Some(child) = runtime.child.as_mut()
                            {
                                super::process::kill_child_process_group(child);
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
                                sleep_enabled: runtime.sleep_enabled,
                                sleep_idle_minutes: runtime.sleep_idle_minutes,
                            })
                        }
                    }
                };

                // A terminal exit is the end of this runtime: drop it from the
                // map so it holds no dead entries and the server can be probed
                // (and re-adopted) fresh on the next runtime query. A sleep exit
                // keeps its entry (the wake listener owns it).
                if matches!(phase, Phase1::Terminal(_)) {
                    guard.remove(&key);
                }
                phase
            };

            let snapshot = match phase1 {
                Phase1::Stop => return,
                Phase1::Terminal(outcome) => {
                    let directory = outcome.event.directory.clone();
                    let _ = app.emit("server-runtime-state", outcome.event.clone());
                    playit::emit_tunnel_state(&app, &directory, "offline", None, None);
                    maybe_auto_restart(&key, &outcome, &processes, &app);
                    return;
                }
                Phase1::Sleep(sleep) => {
                    let directory = sleep.event.directory.clone();
                    let server_port = sleep.params.server_port;
                    // Hand the port to a wake listener. On bind failure, fall back
                    // to plain offline so the server never gets stuck "sleeping"
                    // with nothing holding the port.
                    match spawn_sleep_listener(processes.clone(), app.clone(), sleep.params) {
                        Ok(handle) => {
                            if let Ok(mut guard) = processes.lock()
                                && let Some(runtime) = guard.get_mut(&key)
                            {
                                runtime.sleep_stop = Some(handle);
                            }
                            let _ = app.emit("server-runtime-state", sleep.event);
                            playit::emit_tunnel_state(&app, &directory, "offline", None, None);
                            emit_system_line(
                                &app,
                                &directory,
                                "No players online — server is now sleeping. It will wake automatically when someone joins.",
                            );
                        }
                        Err(err) => {
                            if let Ok(mut guard) = processes.lock() {
                                guard.remove(&key);
                            }
                            let _ = app.emit(
                                "server-runtime-state",
                                ServerRuntimeStateEvent {
                                    directory: directory.clone(),
                                    state: LifecycleState::Offline,
                                    pid: None,
                                    started_at: None,
                                    exit_code: None,
                                    stderr_tail: Vec::new(),
                                    server_port: Some(server_port),
                                },
                            );
                            playit::emit_tunnel_state(&app, &directory, "offline", None, None);
                            emit_system_line(
                                &app,
                                &directory,
                                format!("Could not enter sleep mode: {err}"),
                            );
                        }
                    }
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
                    .map(|pid| collect_process_metrics(pid, snapshot.configured_ram))
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

            // ---- Idle tracking for sleep mode (owned, non-proxy, online only).
            let now = Instant::now();
            if snapshot.sleep_enabled
                && !snapshot.is_proxy
                && snapshot.has_child
                && matches!(new_state, LifecycleState::Online)
            {
                match status.players_online {
                    // Confirmed empty: start (or keep) the idle clock.
                    Some(0) => {
                        idle_since.get_or_insert(now);
                    }
                    // Someone is on, or SLP couldn't report a count (unknown):
                    // reset — we never sleep a server we can't prove is idle.
                    _ => idle_since = None,
                }
            } else {
                idle_since = None;
            }
            let idle_for = idle_since
                .map(|since| now.duration_since(since))
                .unwrap_or_default();
            let sleep_threshold =
                Duration::from_secs(u64::from(snapshot.sleep_idle_minutes.max(1)) * 60);
            let sleep_now = should_sleep(
                new_state,
                snapshot.has_child,
                snapshot.is_proxy,
                snapshot.sleep_enabled,
                status.players_online,
                idle_for,
                sleep_threshold,
            );

            // ---- Phase 3: brief lock — write back state/sample, prepare events.
            let mut state_change: Option<ServerRuntimeStateEvent> = None;
            let mut sleep_initiated = false;
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
                // Latch "reached online at least once" — gates backend auto-restart
                // so only servers that actually booted get restarted on crash.
                if matches!(new_state, LifecycleState::Online) {
                    runtime.ever_online = true;
                }
                if sleep_now
                    && matches!(runtime.state, LifecycleState::Online)
                    && !runtime.stop_requested
                {
                    // Idle long enough: gracefully stop into sleep mode. The exit
                    // is recognized as a sleep (not a crash) in phase 1, which
                    // spawns the wake listener.
                    runtime.sleep_requested = true;
                    runtime.stop_requested = true;
                    runtime.stop_requested_at = Some(Instant::now());
                    runtime.state = LifecycleState::Stopping;
                    send_stop_via_stdin(runtime);
                    idle_since = None;
                    sleep_initiated = true;
                    state_change = Some(state_event(runtime));
                } else if runtime.state != new_state {
                    runtime.state = new_state;
                    state_change = Some(state_event(runtime));
                }
                // An adopted server that stopped answering is done: drop the
                // entry (see the terminal-exit removal in phase 1).
                if external_terminal {
                    guard.remove(&key);
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
            if sleep_initiated {
                emit_system_line(
                    &app,
                    &snapshot.directory,
                    format!(
                        "No players for {} minute(s) — putting the server to sleep.",
                        snapshot.sleep_idle_minutes.max(1)
                    ),
                );
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

    #[test]
    fn terminal_state_requested_stop_is_offline() {
        assert_eq!(
            terminal_state(true, false, Some(0)),
            LifecycleState::Offline
        );
        assert_eq!(
            terminal_state(true, false, Some(130)),
            LifecycleState::Offline
        );
    }

    #[test]
    fn terminal_state_clean_exit_is_offline_even_if_unrequested() {
        assert_eq!(
            terminal_state(false, false, Some(0)),
            LifecycleState::Offline
        );
    }

    #[test]
    fn terminal_state_unrequested_nonzero_is_crashed() {
        assert_eq!(
            terminal_state(false, false, Some(1)),
            LifecycleState::Crashed
        );
        assert_eq!(terminal_state(false, false, None), LifecycleState::Crashed);
    }

    #[test]
    fn terminal_state_sleep_request_wins() {
        // An idle-sleep stop parks in Sleeping regardless of exit code.
        assert_eq!(
            terminal_state(true, true, Some(0)),
            LifecycleState::Sleeping
        );
        assert_eq!(
            terminal_state(true, true, Some(1)),
            LifecycleState::Sleeping
        );
        assert_eq!(terminal_state(false, true, None), LifecycleState::Sleeping);
    }

    #[test]
    fn should_auto_restart_requires_all_conditions() {
        // Happy path: enabled, unrequested, reached online, under the cap.
        assert!(should_auto_restart(true, false, true, 0));
        assert!(should_auto_restart(
            true,
            false,
            true,
            MAX_RESTARTS_IN_WINDOW - 1
        ));
    }

    #[test]
    fn should_auto_restart_blocks_disabled_requested_or_boot_failures() {
        // Disabled.
        assert!(!should_auto_restart(false, false, true, 0));
        // Requested (user/console stop).
        assert!(!should_auto_restart(true, true, true, 0));
        // Never reached online — a boot failure the frontend step-down handles.
        assert!(!should_auto_restart(true, false, false, 0));
    }

    #[test]
    fn should_auto_restart_stops_after_crash_loop_cap() {
        assert!(!should_auto_restart(
            true,
            false,
            true,
            MAX_RESTARTS_IN_WINDOW
        ));
        assert!(!should_auto_restart(
            true,
            false,
            true,
            MAX_RESTARTS_IN_WINDOW + 5
        ));
    }

    #[test]
    fn restart_history_counts_and_prunes() {
        let key = "test-restart-history-key";
        assert_eq!(recent_restart_count(key), 0);
        record_restart(key);
        record_restart(key);
        assert_eq!(recent_restart_count(key), 2);
        // A distinct key is tracked independently.
        assert_eq!(recent_restart_count("other-key"), 0);
    }

    const MIN: Duration = Duration::from_secs(60);

    #[test]
    fn should_sleep_when_idle_long_enough_and_empty() {
        assert!(should_sleep(
            LifecycleState::Online,
            true,
            false,
            true,
            Some(0),
            15 * MIN,
            15 * MIN,
        ));
    }

    #[test]
    fn should_not_sleep_before_threshold() {
        assert!(!should_sleep(
            LifecycleState::Online,
            true,
            false,
            true,
            Some(0),
            14 * MIN,
            15 * MIN,
        ));
    }

    #[test]
    fn should_not_sleep_with_players_or_unknown_count() {
        // Players online.
        assert!(!should_sleep(
            LifecycleState::Online,
            true,
            false,
            true,
            Some(2),
            30 * MIN,
            15 * MIN,
        ));
        // Unknown (SLP failed) — never sleep on an unproven-idle server.
        assert!(!should_sleep(
            LifecycleState::Online,
            true,
            false,
            true,
            None,
            30 * MIN,
            15 * MIN,
        ));
    }

    #[test]
    fn should_not_sleep_when_disabled_proxy_external_or_not_online() {
        // Disabled.
        assert!(!should_sleep(
            LifecycleState::Online,
            true,
            false,
            false,
            Some(0),
            30 * MIN,
            15 * MIN,
        ));
        // Proxy.
        assert!(!should_sleep(
            LifecycleState::Online,
            true,
            true,
            true,
            Some(0),
            30 * MIN,
            15 * MIN,
        ));
        // No owned child (adopted/external).
        assert!(!should_sleep(
            LifecycleState::RunningExternal,
            false,
            false,
            true,
            Some(0),
            30 * MIN,
            15 * MIN,
        ));
        // Not online yet.
        assert!(!should_sleep(
            LifecycleState::Starting,
            true,
            false,
            true,
            Some(0),
            30 * MIN,
            15 * MIN,
        ));
    }
}
