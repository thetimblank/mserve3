use super::super::support::playit;
use super::super::support::{
    RconClient, emit_output_reader, emit_system_line, ensure_rcon_enabled, get_runtime_config,
    infer_provider_version, isolate_in_own_process_group, kill_child_process_group,
    kill_process_tree, next_generation, no_window_command, offline_state_event, patch_mserve_json,
    pid_listening_on_port, probe_port, read_rcon_config, release_child_from_app_lifetime,
    remove_if_current, resolve_telemetry_target, server_key, set_server_port, spawn_supervisor,
    state_event, stop_request, terminate_runtime, tie_child_to_app_lifetime, wait_for_port_release,
    write_stdin_line,
};
use super::super::{
    LifecycleState, RuntimeServerConfig, RuntimeState, ServerRuntime, ServerRuntimeSnapshot,
    ServerRuntimeStateEvent, ServerTunnelInfo, TpsCommandState,
};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, State};

/// Formats a heap size (in gigabytes, fractional allowed) into a JVM size token.
/// Whole gigabytes use the `G` suffix; sub-gigabyte values fall back to `M` so
/// values like 0.5 GB are emitted as `512M` (the JVM rejects fractional `G`).
fn format_heap_size(ram_gb: f64) -> String {
    let megabytes = (ram_gb.max(0.25) * 1024.0).round() as u64;
    if megabytes.is_multiple_of(1024) {
        format!("{}G", megabytes / 1024)
    } else {
        format!("{megabytes}M")
    }
}

/// Modern Forge/NeoForge servers are not launched with `-jar`; their installer
/// generates a JVM `@argfile` under `libraries/` that wires up the module path.
/// Returns the `@`-prefixed argfile token (relative to the server directory,
/// which is the child's working directory) when one exists.
fn resolve_launch_argfile(directory: &Path, config: &RuntimeServerConfig) -> Option<String> {
    let provider = config
        .provider
        .as_ref()
        .map(|provider| provider.name.to_lowercase())
        .unwrap_or_default();

    let vendor_dir = if provider.contains("neoforge") {
        directory
            .join("libraries")
            .join("net")
            .join("neoforged")
            .join("neoforge")
    } else if provider.contains("forge") {
        directory
            .join("libraries")
            .join("net")
            .join("minecraftforge")
            .join("forge")
    } else {
        return None;
    };

    let args_file_name = if cfg!(windows) {
        "win_args.txt"
    } else {
        "unix_args.txt"
    };

    // One subdirectory per installed loader version (normally exactly one).
    let entries = fs::read_dir(&vendor_dir).ok()?;
    for entry in entries.flatten() {
        let candidate = entry.path().join(args_file_name);
        if candidate.is_file() {
            let relative = candidate
                .strip_prefix(directory)
                .map(Path::to_path_buf)
                .unwrap_or(candidate);
            return Some(format!("@{}", relative.to_string_lossy()));
        }
    }

    None
}

fn resolve_server_start_args(directory: &Path, config: &RuntimeServerConfig) -> Vec<String> {
    let heap = format_heap_size(config.ram.unwrap_or(4.0));
    let mut args = vec![format!("-Xmx{heap}"), format!("-Xms{heap}")];

    // Forge/NeoForge installations launch through their generated argfile;
    // everything else is a plain executable jar.
    if let Some(argfile) = resolve_launch_argfile(directory, config) {
        args.push(argfile);
    } else {
        let file = if config.file.trim().is_empty() {
            "server.jar".to_string()
        } else {
            config.file.trim().to_string()
        };
        args.push("-jar".to_string());
        args.push(file);
    }

    args.extend(config.custom_flags.clone().unwrap_or_default());
    args
}

const NO_JAVA_ERROR: &str =
    "No Java runtime is available for this server. Open the Java guide to install Java.";

/// Resolves the Java executable to launch with. The per-server pinned override
/// (persisted in mserve.json) wins; otherwise the caller passes the runtime it
/// resolved on the frontend. There is no implicit bare-`java` fallback — an
/// unspecified runtime is an error so we never silently launch an unsupported
/// system Java.
fn resolve_java_executable(
    config: &RuntimeServerConfig,
    java_executable: Option<&str>,
) -> Result<String, String> {
    if let Some(server_java) = config
        .java_installation
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(server_java.to_string());
    }

    if let Some(resolved) = java_executable
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(resolved.to_string());
    }

    Err(NO_JAVA_ERROR.to_string())
}

fn build_server_start_command(
    directory: &Path,
    config: &RuntimeServerConfig,
    java_executable: &str,
) -> String {
    let args = resolve_server_start_args(directory, config);
    format!("{} {}", java_executable, args.join(" "))
}

/// Confirms the resolved executable actually exists before we try to spawn it,
/// turning a cryptic OS spawn error into an actionable message.
fn ensure_java_executable_exists(java_executable: &str) -> Result<(), String> {
    if PathBuf::from(java_executable).is_file() {
        return Ok(());
    }

    Err(format!(
        "Java executable was not found at \"{java_executable}\". Re-detect Java or pick another runtime in settings."
    ))
}

/// True for proxy software (Velocity/BungeeCord/Waterfall), which has no RCON,
/// no in-game TPS, and only answers a status ping.
fn provider_is_proxy(config: &RuntimeServerConfig) -> bool {
    let name = config
        .provider
        .as_ref()
        .map(|provider| provider.name.to_lowercase())
        .unwrap_or_default();
    name.contains("velocity") || name.contains("bungee") || name.contains("waterfall")
}

/// Console commands that shut a server down, per provider; the first is the one
/// sent for a graceful stop. BungeeCord/Waterfall only know `end`; Velocity's
/// `shutdown` also answers to `end` and `stop`. Mirrored by `isStopCommand` in
/// `src/pages/server/server-utils.ts`.
fn shutdown_commands_for(config: &RuntimeServerConfig) -> &'static [&'static str] {
    let name = config
        .provider
        .as_ref()
        .map(|provider| provider.name.to_lowercase())
        .unwrap_or_default();
    if name.contains("velocity") {
        &["shutdown", "end", "stop"]
    } else if name.contains("bungee") || name.contains("waterfall") {
        &["end"]
    } else {
        &["stop"]
    }
}

fn resolve_server_id(config: &RuntimeServerConfig, key: &str) -> String {
    config
        .id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| key.to_string())
}

type Processes = Arc<Mutex<HashMap<String, ServerRuntime>>>;

const DEFAULT_MC_PORT: u16 = 25565;

/// Returns the lowest port >= `start_port` that is not already in active use by
/// another managed server (`exclude_key` is the caller's own entry).
fn find_next_available_port(
    processes: &HashMap<String, ServerRuntime>,
    start_port: u16,
    exclude_key: &str,
) -> u16 {
    let in_use: std::collections::HashSet<u16> = processes
        .iter()
        .filter(|(key, r)| key.as_str() != exclude_key && r.state.is_active())
        .map(|(_, r)| r.server_port)
        .collect();

    let mut port = start_port;
    while port < u16::MAX && in_use.contains(&port) {
        port = port.saturating_add(1);
    }
    port
}

/// True when an active managed runtime other than `exclude_key` already occupies
/// `host:port`. Guards both sequential port assignment on start and adoption of
/// external servers (so one answering port can never be attributed to two
/// servers).
fn is_port_claimed(
    processes: &HashMap<String, ServerRuntime>,
    host: &str,
    port: u16,
    exclude_key: &str,
) -> bool {
    processes.iter().any(|(key, r)| {
        key.as_str() != exclude_key
            && r.host == host
            && r.server_port == port
            && r.state.is_active()
    })
}

/// A runtime record for `config` with no process attached: the start path
/// reserves the key with one of these and fills the child in once it spawned;
/// adoption keeps it process-less.
fn new_runtime(
    directory: String,
    key: &str,
    config: &RuntimeServerConfig,
    host: String,
    server_port: u16,
    generation: u64,
    state: LifecycleState,
) -> ServerRuntime {
    ServerRuntime {
        directory,
        child: None,
        stdin: None,
        pid: None,
        started_at: chrono::Utc::now(),
        state,
        exit_code: None,
        stderr_tail: VecDeque::new(),
        rcon: None,
        host,
        server_port,
        is_proxy: provider_is_proxy(config),
        shutdown_commands: shutdown_commands_for(config),
        server_id: resolve_server_id(config, key),
        configured_ram: config.ram,
        provider_version: infer_provider_version(config),
        tps_state: TpsCommandState::Unknown,
        latest_sample: None,
        generation,
        stop_requested: false,
        stop_requested_at: None,
        playit_stop: None,
        tunnel_address: None,
        java_executable: None,
        auto_restart: false,
        ever_online: false,
        sleep_enabled: false,
        sleep_idle_minutes: 15,
        sleep_motd: default_sleep_motd(),
        sleep_requested: false,
        sleep_stop: None,
    }
}

/// A start in progress: the key is claimed (see `start_server_internal`) but the
/// JVM isn't attached yet. `Stopping` means a stop/force-kill cancelled it.
fn is_start_reservation(runtime: &ServerRuntime) -> bool {
    runtime.child.is_none()
        && runtime.pid.is_none()
        && runtime.java_executable.is_some()
        && matches!(
            runtime.state,
            LifecycleState::Starting | LifecycleState::Stopping
        )
}

/// A server mserve found running but didn't spawn: owned runtimes (including
/// start reservations and sleeping servers) always record their Java executable.
fn is_adopted(runtime: &ServerRuntime) -> bool {
    runtime.child.is_none() && runtime.java_executable.is_none()
}

const ADOPTED_SERVER_ERROR: &str = "This server was started outside mserve. Stop it there (or use Force Kill) before starting it from mserve.";

/// Directories of the servers whose process mserve owns (or is spawning), i.e.
/// the ones a real quit kills. Sleeping servers have no process (just a wake
/// listener) and adopted servers aren't mserve's to kill, so neither counts
/// toward the close warning.
pub(in crate::app) fn owned_running_server_directories(
    processes: &HashMap<String, ServerRuntime>,
) -> Vec<String> {
    processes
        .values()
        .filter(|r| r.child.is_some() || is_start_reservation(r))
        .map(|r| r.directory.clone())
        .collect()
}

/// Runs blocking command work (spawns, port probes, RCON, bounded waits) on the
/// blocking pool. Synchronous Tauri commands execute on the main thread, so doing
/// this inline would freeze the window.
async fn run_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| err.to_string())?
}

/// Brings up this server's playit tunnel asynchronously (when enabled) so server
/// start isn't blocked on network I/O. Provisions/reuses the tunnel, starts the
/// in-process agent, stores its stop handle on the runtime, and emits
/// `playit-tunnel-state` transitions. If the server is torn down while the tunnel
/// is still coming up, the freshly-started agent is stopped immediately.
fn launch_tunnel(
    app: tauri::AppHandle,
    processes: Processes,
    key: String,
    directory: String,
    config: &RuntimeServerConfig,
    server_port: u16,
    generation: u64,
) {
    if !config.tunnel_enabled {
        return;
    }
    let directory_path = PathBuf::from(directory.trim());
    let Some(secret) = playit::read_secret(&app) else {
        playit::emit_tunnel_state(
            &app,
            &directory,
            "error",
            None,
            Some("playit.gg account is not connected.".to_string()),
        );
        return;
    };

    let server_name = directory_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("mserve-server")
        .to_string();
    let stored_id = config.tunnel_id.clone();

    playit::emit_tunnel_state(&app, &directory, "starting", None, None);

    tauri::async_runtime::spawn(async move {
        match playit::start_tunnel(secret, server_name, server_port, stored_id).await {
            Ok(handle) => {
                // Attach the stop handle to the runtime — but only if this server is
                // still the same live generation. If it went down (or restarted)
                // during setup, stop the agent we just started.
                let attached = match processes.lock() {
                    Ok(mut guard) => match guard.get_mut(&key) {
                        Some(rt)
                            if rt.generation == generation
                                && rt.child.is_some()
                                && !rt.stop_requested =>
                        {
                            rt.playit_stop = Some(handle.cancel.clone());
                            rt.tunnel_address = Some(handle.address.clone());
                            true
                        }
                        _ => false,
                    },
                    Err(_) => false,
                };

                if !attached {
                    playit::stop_agent(&handle.cancel);
                    playit::emit_tunnel_state(&app, &directory, "offline", None, None);
                    return;
                }

                // Persist the tunnel id + public address so a later start reuses
                // the same tunnel instead of allocating a new one.
                let _ = patch_mserve_json(
                    &directory_path,
                    &[
                        ("tunnel_id", serde_json::json!(handle.tunnel_id)),
                        ("tunnel_address", serde_json::json!(handle.address)),
                    ],
                );
                playit::emit_tunnel_state(&app, &directory, "online", Some(handle.address), None);
            }
            Err(err) => {
                playit::emit_tunnel_state(&app, &directory, "error", None, Some(err));
            }
        }
    });
}

/// The default sleeping-server MOTD, shown in the client server list while a
/// server naps. Shares the canonical string with the config layer.
pub(in crate::app) fn default_sleep_motd() -> String {
    super::super::support::DEFAULT_SLEEP_MOTD.to_string()
}

/// Drops a failed start's reservation (only while it is still ours) and reports
/// the server offline — unless a newer runtime has taken the key since.
fn release_reservation(
    processes: &Processes,
    key: &str,
    generation: u64,
    directory: &str,
    server_port: u16,
    app: &tauri::AppHandle,
) {
    let removed = remove_if_current(processes, key, generation).is_some();
    let replaced = processes.lock().is_ok_and(|guard| guard.contains_key(key));
    if removed || !replaced {
        let _ = app.emit(
            "server-runtime-state",
            offline_state_event(directory.to_string(), server_port),
        );
    }
}

/// Core start routine, shared by the `start_server` command, the restart flow,
/// backend auto-restart (supervisor), and sleep-mode wake (sleep listener).
pub(in crate::app) fn start_server_internal(
    directory: String,
    java_executable: Option<String>,
    processes: Processes,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let config = get_runtime_config(&directory_path)?;
    let key = server_key(&directory);
    let java_executable = resolve_java_executable(&config, java_executable.as_deref())?;
    ensure_java_executable_exists(&java_executable)?;
    let (host, configured_port) = resolve_telemetry_target(&config, &directory_path);
    let is_proxy = provider_is_proxy(&config);
    let generation = next_generation();

    // Claim the key in the same critical section as the "already running" check,
    // so concurrent starters (this command, a restart thread, auto-restart, a
    // wake) can never both spawn a JVM for one server. A sleeping entry means the
    // wake listener owns the port — signal it to stop; the port-free wait below
    // is the "wake" path.
    let (sleeping_port, server_port) = {
        let mut guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
        let mut sleeping_port = None;
        if let Some(existing) = guard.get_mut(&key) {
            if is_start_reservation(existing) {
                return Err("Server is already starting.".to_string());
            }
            let alive = existing
                .child
                .as_mut()
                .is_some_and(|child| matches!(child.try_wait(), Ok(None)));
            if alive {
                return Err("Server is already running.".to_string());
            }
            if is_adopted(existing) {
                return Err(ADOPTED_SERVER_ERROR.to_string());
            }
            if matches!(existing.state, LifecycleState::Sleeping) {
                sleeping_port = Some(existing.server_port);
            }
            stop_sleep_listener(existing);
            if let Some(stop) = existing.playit_stop.take() {
                playit::stop_agent(&stop);
            }
        }

        // Sequential port assignment: if the resolved port is already claimed by
        // another active managed server, step up to the next free port. Decided
        // under the same lock that publishes the reservation (which carries the
        // port), so two siblings starting together can't both pick the same one.
        let server_port = if is_port_claimed(&guard, &host, configured_port, &key) {
            find_next_available_port(&guard, DEFAULT_MC_PORT, &key)
        } else {
            configured_port
        };

        let mut reservation = new_runtime(
            directory.clone(),
            &key,
            &config,
            host.clone(),
            server_port,
            generation,
            LifecycleState::Starting,
        );
        reservation.java_executable = Some(java_executable.clone());
        reservation.auto_restart = config.auto_restart;
        reservation.sleep_enabled = config.sleep_enabled && !is_proxy;
        reservation.sleep_idle_minutes = config.sleep_idle_minutes.unwrap_or(15).max(1);
        reservation.sleep_motd = config
            .sleep_motd
            .clone()
            .filter(|motd| !motd.trim().is_empty())
            .unwrap_or_else(default_sleep_motd);
        guard.insert(key.clone(), reservation);
        (sleeping_port, server_port)
    };

    let spawn = || -> Result<u16, String> {
        if let Some(port) = sleeping_port {
            wait_for_port_release(&directory_path, port);
        }

        let args = resolve_server_start_args(&directory_path, &config);
        let command_str = build_server_start_command(&directory_path, &config, &java_executable);
        eprintln!("[Server] Executing: {command_str}");

        // Persist a reassigned port so future starts and the frontend stay in sync.
        if server_port != configured_port {
            set_server_port(&directory_path, server_port)
                .unwrap_or_else(|e| eprintln!("[Server] Could not update server-port: {e}"));
            patch_mserve_json(
                &directory_path,
                &[("telemetry_port", serde_json::json!(server_port))],
            )
            .unwrap_or_else(|e| eprintln!("[Server] Could not patch mserve.json port: {e}"));
        }

        // Provision a reliable RCON channel for non-proxy servers.
        let rcon = if is_proxy {
            None
        } else {
            ensure_rcon_enabled(&directory_path).ok()
        };

        let mut command = no_window_command(&java_executable);
        command
            .args(args)
            .current_dir(&directory_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        isolate_in_own_process_group(&mut command);
        let mut child = command
            .spawn()
            .map_err(|err| format!("Failed to start java process: {err}"))?;

        // Bind the server (and everything it spawns) to mserve's lifetime so an
        // mserve crash or "End task" can never leave an orphaned java process
        // squatting on the port.
        tie_child_to_app_lifetime(&child);

        let stdin = child.stdin.take().map(|stdin| Arc::new(Mutex::new(stdin)));
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let pid = child.id();
        let started_at = chrono::Utc::now();

        // Attach the child to our reservation — unless a stop, force-kill or
        // delete cancelled the start while we were spawning.
        let mut cancelled = Some(child);
        if let Ok(mut guard) = processes.lock()
            && let Some(runtime) = guard.get_mut(&key)
            && runtime.generation == generation
            && !runtime.stop_requested
        {
            runtime.child = cancelled.take();
            runtime.stdin = stdin;
            runtime.pid = Some(pid);
            runtime.started_at = started_at;
            runtime.rcon = rcon;
            runtime.server_port = server_port;
        }
        if let Some(mut child) = cancelled {
            kill_child_process_group(&child);
            let _ = child.kill();
            let _ = child.wait();
            release_child_from_app_lifetime(pid);
            return Err("The start was cancelled.".to_string());
        }

        if let Some(stdout) = stdout {
            emit_output_reader(
                stdout,
                directory.clone(),
                key.clone(),
                "stdout",
                app.clone(),
                processes.clone(),
            );
        }
        if let Some(stderr) = stderr {
            emit_output_reader(
                stderr,
                directory.clone(),
                key.clone(),
                "stderr",
                app.clone(),
                processes.clone(),
            );
        }

        // Bring up the playit tunnel (if enabled) off the start path — it
        // provisions over the network and must not block or fail the server start.
        launch_tunnel(
            app.clone(),
            processes.clone(),
            key.clone(),
            directory.clone(),
            &config,
            server_port,
            generation,
        );

        spawn_supervisor(processes.clone(), app.clone(), key.clone(), generation);

        let _ = app.emit(
            "server-runtime-state",
            ServerRuntimeStateEvent {
                directory: directory.clone(),
                state: LifecycleState::Starting,
                pid: Some(pid),
                started_at: Some(started_at.to_rfc3339()),
                exit_code: None,
                stderr_tail: Vec::new(),
                server_port: Some(server_port),
            },
        );
        Ok(server_port)
    };

    match spawn() {
        Ok(_) => Ok("Server started.".to_string()),
        Err(err) => {
            release_reservation(&processes, &key, generation, &directory, server_port, &app);
            Err(err)
        }
    }
}

#[tauri::command]
pub(in crate::app) async fn start_server(
    directory: String,
    java_executable: Option<String>,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let processes = state.processes.clone();
    run_blocking(move || start_server_internal(directory, java_executable, processes, app)).await
}

#[tauri::command]
pub(in crate::app) fn get_server_start_command(
    directory: String,
    java_executable: Option<String>,
) -> Result<String, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let config = get_runtime_config(&directory_path)?;
    let java_executable = resolve_java_executable(&config, java_executable.as_deref())?;
    Ok(build_server_start_command(
        &directory_path,
        &config,
        &java_executable,
    ))
}

/// True when a console command is a graceful shutdown for this server (see
/// [`shutdown_commands_for`]), matching the frontend's `isStopCommand`. Used so a
/// console-typed stop is recorded as a requested close (no crash, no
/// auto-restart). Proxies take a trailing reason (`end <message>`); game servers
/// only a bare `stop`. The leading slash is already stripped by the caller.
fn is_stop_command(command: &str, shutdown_commands: &[&str], is_proxy: bool) -> bool {
    let command = command.trim();
    let word = if is_proxy {
        command.split_whitespace().next().unwrap_or_default()
    } else {
        command
    };
    shutdown_commands
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(word))
}

/// Signals a sleeping server's wake listener to shut down (releasing the port).
/// No-op for a server that isn't sleeping.
fn stop_sleep_listener(runtime: &mut ServerRuntime) {
    if let Some(flag) = runtime.sleep_stop.take() {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Tears down a sleeping server's wake listener and the tunnel agent that kept
/// fronting it, returning the offline event to emit once the entry is removed.
fn release_sleeping(runtime: &mut ServerRuntime) -> ServerRuntimeStateEvent {
    stop_sleep_listener(runtime);
    if let Some(stop) = runtime.playit_stop.take() {
        playit::stop_agent(&stop);
    }
    runtime.tunnel_address = None;
    offline_state_event(runtime.directory.clone(), runtime.server_port)
}

/// Emits an offline lifecycle event plus the matching tunnel-offline event.
fn emit_offline(app: &tauri::AppHandle, event: ServerRuntimeStateEvent) {
    let directory = event.directory.clone();
    let _ = app.emit("server-runtime-state", event);
    playit::emit_tunnel_state(app, &directory, "offline", None, None);
}

/// Flags a runtime as gracefully stopping (idempotent). Already-terminal
/// (offline/crashed) runtimes are left as-is so their state isn't resurrected.
fn mark_stopping(runtime: &mut ServerRuntime) {
    runtime.stop_requested = true;
    runtime.stop_requested_at = Some(Instant::now());
    if !matches!(
        runtime.state,
        LifecycleState::Offline | LifecycleState::Crashed
    ) {
        runtime.state = LifecycleState::Stopping;
    }
}

/// After an out-of-lock RCON shutdown, marks the runtime stopping — if it is still
/// the same runtime — and reports it.
fn mark_stopping_if_current(
    processes: &Processes,
    key: &str,
    generation: u64,
    app: &tauri::AppHandle,
) {
    let event = processes.lock().ok().and_then(|mut guard| {
        let runtime = guard.get_mut(key)?;
        if runtime.generation != generation {
            return None;
        }
        mark_stopping(runtime);
        Some(state_event(runtime))
    });
    if let Some(event) = event {
        let _ = app.emit("server-runtime-state", event);
    }
}

fn stop_server_blocking(
    directory: &str,
    processes: &Processes,
    app: &tauri::AppHandle,
) -> Result<String, String> {
    let key = server_key(directory);
    let mut guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
    let runtime = guard
        .get_mut(&key)
        .ok_or_else(|| "Server is not running.".to_string())?;

    // A sleeping server has no process — just tear the wake listener down and
    // report it offline (this is "stop sleeping").
    if matches!(runtime.state, LifecycleState::Sleeping) {
        let event = release_sleeping(runtime);
        guard.remove(&key);
        drop(guard);
        emit_offline(app, event);
        return Ok("Server is no longer sleeping.".to_string());
    }

    // Still spawning: flag the reservation; the start path kills the fresh JVM
    // instead of attaching it.
    if is_start_reservation(runtime) {
        mark_stopping(runtime);
        let event = state_event(runtime);
        drop(guard);
        let _ = app.emit("server-runtime-state", event);
        return Ok("Cancelling the start.".to_string());
    }

    // Prefer stdin for owned servers (output shows in the terminal); fall back to
    // RCON for adopted servers. The supervisor detects exit and emits `offline`.
    if let Some(stop) = stop_request(runtime) {
        mark_stopping(runtime);
        let event = state_event(runtime);
        drop(guard);
        let _ = app.emit("server-runtime-state", event);
        stop.send();
        return Ok("Stopping server.".to_string());
    }

    let Some(rcon) = runtime.rcon.clone() else {
        return Err(
            "This server was started outside mserve and has no RCON channel — use Force Kill."
                .to_string(),
        );
    };
    let host = runtime.host.clone();
    let generation = runtime.generation;
    let command = runtime.shutdown_commands.first().copied().unwrap_or("stop");
    drop(guard);
    let mut client =
        RconClient::connect(&host, rcon.port, &rcon.password, Duration::from_millis(900))
            .map_err(|err| format!("Could not reach the server over RCON to stop it ({err})."))?;
    // Connected: the shutdown is going out. A server that stops quickly can drop
    // the socket before replying, so a missing reply doesn't mean it ignored us.
    mark_stopping_if_current(processes, &key, generation, app);
    if let Err(err) = client.command(command) {
        return Err(format!(
            "Sent the stop over RCON but got no reply ({err}); the server may still be shutting down."
        ));
    }

    Ok("Stopping server.".to_string())
}

#[tauri::command]
pub(in crate::app) async fn stop_server(
    directory: String,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let processes = state.processes.clone();
    run_blocking(move || stop_server_blocking(&directory, &processes, &app)).await
}

/// Manually parks an owned, non-proxy, online server in sleep mode right now —
/// the same graceful-stop-into-`Sleeping` path the idle timer takes, except it
/// bypasses the `sleep_enabled` config gate entirely: a manual request always
/// wins. The supervisor classifies the exit via `sleep_requested` and spawns the
/// wake listener exactly as it does for an idle-triggered sleep.
#[tauri::command]
pub(in crate::app) async fn sleep_server(
    directory: String,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let processes = state.processes.clone();
    run_blocking(move || sleep_server_blocking(&directory, &processes, &app)).await
}

fn sleep_server_blocking(
    directory: &str,
    processes: &Processes,
    app: &tauri::AppHandle,
) -> Result<String, String> {
    let key = server_key(directory);
    let mut guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
    let runtime = guard
        .get_mut(&key)
        .ok_or_else(|| "Server is not running.".to_string())?;

    if !matches!(runtime.state, LifecycleState::Online) {
        return Err("Server must be online to sleep.".to_string());
    }
    if runtime.is_proxy {
        return Err("Proxy servers don't support sleep mode.".to_string());
    }
    if runtime.child.is_none() {
        return Err(
            "This server was started outside mserve and can't be put to sleep — use Stop or Force Kill instead."
                .to_string(),
        );
    }

    runtime.sleep_requested = true;
    mark_stopping(runtime);
    let event = state_event(runtime);
    let stop = stop_request(runtime);
    drop(guard);
    let _ = app.emit("server-runtime-state", event);
    if let Some(stop) = stop {
        stop.send();
    }

    Ok("Putting server to sleep.".to_string())
}

#[tauri::command]
pub(in crate::app) async fn restart_server(
    directory: String,
    java_executable: Option<String>,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let processes = state.processes.clone();
    run_blocking(move || restart_server_blocking(directory, java_executable, processes, app)).await
}

fn restart_server_blocking(
    directory: String,
    java_executable: Option<String>,
    processes: Processes,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let key = server_key(&directory);

    // Signal a graceful stop on the running process (if any).
    let stopping = {
        let mut guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
        match guard.get_mut(&key) {
            Some(runtime) if is_adopted(runtime) => {
                return Err(ADOPTED_SERVER_ERROR.to_string());
            }
            Some(runtime) if runtime.child.is_some() => {
                mark_stopping(runtime);
                Some((state_event(runtime), stop_request(runtime)))
            }
            _ => None,
        }
    };
    if let Some((event, stop)) = stopping {
        let _ = app.emit("server-runtime-state", event);
        if let Some(stop) = stop {
            stop.send();
        }
    }

    // Wait for the old process to exit (supervisor escalates to a kill at grace),
    // then start fresh, off the command thread.
    std::thread::spawn(move || {
        for _ in 0..200 {
            let done = match processes.lock() {
                Ok(guard) => guard.get(&key).is_none_or(|rt| rt.child.is_none()),
                Err(_) => true,
            };
            if done {
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        if let Err(err) =
            start_server_internal(directory.clone(), java_executable, processes, app.clone())
        {
            emit_system_line(&app, &directory, format!("Restart failed: {err}"));
        }
    });

    Ok("Restarting server.".to_string())
}

fn force_kill_server_blocking(
    directory: &str,
    processes: &Processes,
    app: &tauri::AppHandle,
) -> Result<String, String> {
    let key = server_key(directory);

    // Owned child: kill it directly; the supervisor reports the exit.
    let (directory, server_port, generation) = {
        let mut guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
        let Some(runtime) = guard.get_mut(&key) else {
            return Ok("No running server process found.".to_string());
        };
        // Sleeping: mserve itself holds the port with the wake listener. Never
        // fall through to the port-kill path (it would target mserve's own PID).
        if matches!(runtime.state, LifecycleState::Sleeping) {
            let event = release_sleeping(runtime);
            guard.remove(&key);
            drop(guard);
            emit_offline(app, event);
            return Ok("Server is no longer sleeping.".to_string());
        }
        mark_stopping(runtime);
        let event = state_event(runtime);
        // Still spawning: the start path kills the JVM when it sees the flag.
        // (Never port-kill here: during a wake the port may still be mserve's.)
        if is_start_reservation(runtime) {
            drop(guard);
            let _ = app.emit("server-runtime-state", event);
            return Ok("Start cancelled.".to_string());
        }
        if let Some(child) = runtime.child.as_mut() {
            kill_child_process_group(child);
            let _ = child.kill();
            drop(guard);
            let _ = app.emit("server-runtime-state", event);
            return Ok("Server process was force killed.".to_string());
        }
        (
            runtime.directory.clone(),
            runtime.server_port,
            runtime.generation,
        )
    };

    // Adopted (externally started) server: we hold no process handle, so kill
    // whatever is actually listening on its port. If nothing is, the process is
    // already gone. Either way the runtime record is stale — drop it and tell
    // the UI the server is offline (the supervisor exits once the entry is gone).
    let result = match pid_listening_on_port(server_port) {
        Some(pid) => kill_process_tree(pid)
            .map(|()| format!("Force killed external server process (PID {pid})."))
            .map_err(|err| format!("Could not kill external server process (PID {pid}): {err}")),
        None => Ok("Server process no longer exists — cleared its runtime state.".to_string()),
    };

    // Only clear the record we acted on; a start may have replaced it meanwhile.
    if remove_if_current(processes, &key, generation).is_some() {
        emit_offline(app, offline_state_event(directory, server_port));
    }

    result
}

#[tauri::command]
pub(in crate::app) async fn force_kill_server(
    directory: String,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let processes = state.processes.clone();
    run_blocking(move || force_kill_server_blocking(&directory, &processes, &app)).await
}

/// Send the app to the background: destroy the main webview window so the
/// WebView2 renderer is fully torn down (freeing its RAM/CPU) while the Rust
/// process — and therefore every supervisor thread and child server process —
/// keeps running. The window is rebuilt on demand from the tray icon.
#[tauri::command]
pub(in crate::app) fn run_in_background(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        window.destroy().map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(in crate::app) fn force_kill_all_servers(state: State<'_, RuntimeState>) -> Result<(), String> {
    let mut guard = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
    for runtime in guard.values_mut() {
        mark_stopping(runtime);
        // Release any wake listener so its port is freed on shutdown.
        stop_sleep_listener(runtime);
        if let Some(stop) = runtime.playit_stop.take() {
            playit::stop_agent(&stop);
        }
        if let Some(child) = runtime.child.as_mut() {
            kill_child_process_group(child);
            let _ = child.kill();
        }
    }
    Ok(())
}

fn send_server_command_blocking(
    directory: &str,
    command: &str,
    processes: &Processes,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let normalized = trimmed.trim_start_matches('/').to_string();

    let key = server_key(directory);
    let mut guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
    let runtime = guard
        .get_mut(&key)
        .ok_or_else(|| "Server is not running.".to_string())?;

    // A console shutdown command is a requested shutdown: mark it so the
    // supervisor treats the ensuing exit as intentional (no `crashed`, no
    // auto-restart).
    let is_stop = is_stop_command(&normalized, runtime.shutdown_commands, runtime.is_proxy);

    if let Some(stdin) = runtime.stdin.clone() {
        let event = is_stop.then(|| {
            mark_stopping(runtime);
            state_event(runtime)
        });
        drop(guard);
        if let Some(event) = event {
            let _ = app.emit("server-runtime-state", event);
        }
        return write_stdin_line(&stdin, &normalized);
    }

    let Some(rcon) = runtime.rcon.clone() else {
        return Err("Server is not running.".to_string());
    };
    let host = runtime.host.clone();
    let generation = runtime.generation;
    drop(guard);
    let mut client =
        RconClient::connect(&host, rcon.port, &rcon.password, Duration::from_millis(900))?;
    // Mark before sending: a shutdown command can close the socket before it
    // replies (see `stop_server_blocking`).
    if is_stop {
        mark_stopping_if_current(processes, &key, generation, app);
    }
    client.command(&normalized)?;
    Ok(())
}

#[tauri::command]
pub(in crate::app) async fn send_server_command(
    directory: String,
    command: String,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let processes = state.processes.clone();
    run_blocking(move || send_server_command_blocking(&directory, &command, &processes, &app)).await
}

fn snapshot_from(runtime: &ServerRuntime) -> ServerRuntimeSnapshot {
    ServerRuntimeSnapshot {
        state: runtime.state,
        pid: runtime.pid,
        started_at: Some(runtime.started_at.to_rfc3339()),
        exit_code: runtime.exit_code,
        stderr_tail: runtime.stderr_tail.iter().cloned().collect(),
        sample: runtime.latest_sample.clone(),
        server_port: Some(runtime.server_port),
    }
}

fn offline_snapshot() -> ServerRuntimeSnapshot {
    ServerRuntimeSnapshot {
        state: LifecycleState::Offline,
        pid: None,
        started_at: None,
        exit_code: None,
        stderr_tail: Vec::new(),
        sample: None,
        server_port: None,
    }
}

/// Registers and supervises a server we did not start but found already running
/// (port answering). Lets the UI show it as `running-external` instead of offline.
fn register_external(
    directory: String,
    directory_path: &Path,
    config: &RuntimeServerConfig,
    host: String,
    server_port: u16,
    processes: Processes,
    app: tauri::AppHandle,
) {
    let key = server_key(&directory);
    let generation = next_generation();
    let mut runtime = new_runtime(
        directory,
        &key,
        config,
        host,
        server_port,
        generation,
        LifecycleState::RunningExternal,
    );
    if !runtime.is_proxy {
        runtime.rcon = read_rcon_config(directory_path);
    }

    {
        let Ok(mut guard) = processes.lock() else {
            return;
        };
        if guard.contains_key(&key) {
            return;
        }
        // Don't adopt a host:port already owned by another managed server (see
        // the guard in `get_server_runtime`); this also closes the race between
        // two concurrent adoption probes for sibling servers sharing a port.
        if is_port_claimed(&guard, &runtime.host, runtime.server_port, &key) {
            return;
        }
        guard.insert(key.clone(), runtime);
    }
    spawn_supervisor(processes, app, key, generation);
}

fn get_server_runtime_blocking(
    directory: String,
    processes: &Processes,
    app: tauri::AppHandle,
) -> Result<ServerRuntimeSnapshot, String> {
    let key = server_key(&directory);
    {
        let guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
        if let Some(runtime) = guard.get(&key) {
            return Ok(snapshot_from(runtime));
        }
    }

    // Untracked: probe for an externally-running server and adopt it if found.
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.is_dir() {
        return Ok(offline_snapshot());
    }
    let config = get_runtime_config(&directory_path).unwrap_or_default();
    let (host, server_port) = resolve_telemetry_target(&config, &directory_path);

    // Guard against false adoption: clean-slate servers all default to port
    // 25565, so a probe of *this* server's port may actually hit a *different*
    // managed server that is running on the same host:port. If another live
    // runtime already owns this address, this server is not the one answering —
    // report it offline rather than adopting another server's identity/stats.
    {
        let guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
        if is_port_claimed(&guard, &host, server_port, &key) {
            return Ok(offline_snapshot());
        }
    }

    if probe_port(&host, server_port, Duration::from_millis(400)) {
        register_external(
            directory,
            &directory_path,
            &config,
            host,
            server_port,
            processes.clone(),
            app,
        );
        return Ok(ServerRuntimeSnapshot {
            state: LifecycleState::RunningExternal,
            pid: None,
            started_at: None,
            exit_code: None,
            stderr_tail: Vec::new(),
            sample: None,
            server_port: Some(server_port),
        });
    }

    Ok(offline_snapshot())
}

#[tauri::command]
pub(in crate::app) async fn get_server_runtime(
    directory: String,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<ServerRuntimeSnapshot, String> {
    let processes = state.processes.clone();
    run_blocking(move || get_server_runtime_blocking(directory, &processes, app)).await
}

/// Enables or disables public tunneling for a server. The flag is persisted to
/// `mserve.json` (taking effect on the next start), and if the server is already
/// running the tunnel is brought up / torn down live.
#[tauri::command]
pub(in crate::app) fn set_server_tunnel(
    directory: String,
    enabled: bool,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }
    if enabled && !playit::is_claimed(&app) {
        return Err("Connect a playit.gg account before enabling tunneling.".to_string());
    }

    patch_mserve_json(
        &directory_path,
        &[("tunnel_enabled", serde_json::json!(enabled))],
    )?;

    let key = server_key(&directory);
    let processes = state.processes.clone();

    // Snapshot the live state under the lock, then act outside it.
    let action = {
        let mut guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
        match guard.get_mut(&key) {
            Some(runtime) => {
                let running = runtime.child.is_some()
                    && !matches!(
                        runtime.state,
                        LifecycleState::Offline | LifecycleState::Crashed
                    );
                if enabled {
                    if running && runtime.playit_stop.is_none() {
                        Some(("start", runtime.server_port, runtime.generation))
                    } else {
                        None
                    }
                } else if let Some(stop) = runtime.playit_stop.take() {
                    playit::stop_agent(&stop);
                    runtime.tunnel_address = None;
                    Some(("stop", 0, 0))
                } else {
                    None
                }
            }
            None => None,
        }
    };

    match action {
        Some(("start", port, generation)) => {
            let config = get_runtime_config(&directory_path).unwrap_or_default();
            launch_tunnel(app, processes, key, directory, &config, port, generation);
        }
        Some(("stop", _, _)) => {
            playit::emit_tunnel_state(&app, &directory, "offline", None, None);
        }
        _ => {}
    }

    Ok(())
}

/// Returns the current tunnel state for a server (for a freshly-mounted UI).
#[tauri::command]
pub(in crate::app) fn get_server_tunnel(
    directory: String,
    state: State<'_, RuntimeState>,
) -> Result<ServerTunnelInfo, String> {
    let directory_path = PathBuf::from(directory.trim());
    let config = get_runtime_config(&directory_path).unwrap_or_default();
    let enabled = config.tunnel_enabled;

    let key = server_key(&directory);
    let guard = state.processes.lock().map_err(|_| "Runtime lock failed.")?;

    let (address, status) = match guard.get(&key) {
        Some(runtime) if runtime.playit_stop.is_some() => {
            (runtime.tunnel_address.clone(), "online".to_string())
        }
        _ => {
            let status = if enabled { "offline" } else { "disabled" };
            (config.tunnel_address.clone(), status.to_string())
        }
    };

    Ok(ServerTunnelInfo {
        enabled,
        address,
        status,
    })
}

fn delete_server_blocking(
    directory: &str,
    processes: &Processes,
    app: &tauri::AppHandle,
) -> Result<String, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() {
        return Err("Server directory does not exist.".to_string());
    }

    // Take the runtime out first: the graceful shutdown below can take ~5s and
    // must not run with the `processes` lock held.
    let key = server_key(directory);
    let removed = {
        let mut guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
        // A JVM may be spawning in this directory right now; trashing it
        // underneath the spawn would race the start.
        if guard.get(&key).is_some_and(is_start_reservation) {
            return Err("The server is still starting. Stop it before deleting it.".to_string());
        }
        guard.remove(&key)
    };
    if let Some(mut runtime) = removed {
        let _ = terminate_runtime(&mut runtime);
        emit_offline(
            app,
            offline_state_event(runtime.directory.clone(), runtime.server_port),
        );
    }

    trash::delete(&directory_path).map_err(|err| err.to_string())?;
    Ok("Server moved to recycle bin.".to_string())
}

#[tauri::command]
pub(in crate::app) async fn delete_server(
    directory: String,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let processes = state.processes.clone();
    run_blocking(move || delete_server_blocking(&directory, &processes, &app)).await
}

#[cfg(test)]
mod tests {
    use super::is_stop_command;

    const GAME: &[&str] = &["stop"];
    const BUNGEE: &[&str] = &["end"];
    const VELOCITY: &[&str] = &["shutdown", "end", "stop"];

    #[test]
    fn game_servers_only_stop_on_a_bare_stop() {
        assert!(is_stop_command("stop", GAME, false));
        assert!(is_stop_command("  STOP ", GAME, false));
        assert!(!is_stop_command("stop now", GAME, false));
        assert!(!is_stop_command("end", GAME, false));
    }

    #[test]
    fn bungeecord_stops_on_end_with_optional_reason() {
        // Regression (R-027): `end` used to read as an unrequested exit, so the
        // proxy auto-restarted right after the user shut it down.
        assert!(is_stop_command("end", BUNGEE, true));
        assert!(is_stop_command("end Maintenance", BUNGEE, true));
        assert!(!is_stop_command("stop", BUNGEE, true));
    }

    #[test]
    fn velocity_accepts_shutdown_and_its_aliases() {
        assert!(is_stop_command("shutdown", VELOCITY, true));
        assert!(is_stop_command("end", VELOCITY, true));
        assert!(is_stop_command("stop", VELOCITY, true));
        assert!(!is_stop_command("glist", VELOCITY, true));
    }
}
