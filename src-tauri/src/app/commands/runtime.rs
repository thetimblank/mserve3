use super::super::support::playit;
use super::super::support::{
    RconClient, emit_output_reader, ensure_rcon_enabled, get_runtime_config,
    infer_provider_version, isolate_in_own_process_group, kill_child_process_group,
    kill_process_tree, next_generation, no_window_command, pid_listening_on_port, probe_port,
    read_rcon_config, resolve_telemetry_target, send_stop_via_stdin, server_key, set_server_port,
    spawn_supervisor, terminate_runtime, tie_child_to_app_lifetime,
};
use super::super::{
    LifecycleState, RuntimeServerConfig, RuntimeState, ServerRuntime, ServerRuntimeSnapshot,
    ServerRuntimeStateEvent, ServerTunnelInfo, TpsCommandState,
};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::Write;
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
/// a managed server in the processes map.
fn find_next_available_port(processes: &HashMap<String, ServerRuntime>, start_port: u16) -> u16 {
    let in_use: std::collections::HashSet<u16> = processes
        .values()
        .filter(|r| r.state.is_active())
        .map(|r| r.server_port)
        .collect();

    let mut port = start_port;
    while port < u16::MAX && in_use.contains(&port) {
        port = port.saturating_add(1);
    }
    port
}

/// True when an active managed runtime already occupies `host:port`. Guards
/// both sequential port assignment on start and adoption of external servers
/// (so one answering port can never be attributed to two servers).
fn is_port_claimed(processes: &HashMap<String, ServerRuntime>, host: &str, port: u16) -> bool {
    processes
        .values()
        .any(|r| r.host == host && r.server_port == port && r.state.is_active())
}

/// Patches the `telemetry_port` field in `mserve.json` so subsequent starts
/// (and the next frontend sync) use the correct port.
fn patch_mserve_json_port(directory: &std::path::Path, port: u16) -> Result<(), String> {
    let path = directory.join("mserve.json");
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(obj) = value.as_object_mut() {
        obj.insert("telemetry_port".to_string(), serde_json::json!(port));
    }
    let out = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    std::fs::write(&path, out).map_err(|e| e.to_string())
}

/// Persists the provisioned playit tunnel id + public address into `mserve.json`
/// so a later start reuses the same tunnel instead of allocating a new one.
fn patch_mserve_json_tunnel(
    directory: &std::path::Path,
    tunnel_id: &str,
    address: &str,
) -> Result<(), String> {
    let path = directory.join("mserve.json");
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(obj) = value.as_object_mut() {
        obj.insert("tunnel_id".to_string(), serde_json::json!(tunnel_id));
        obj.insert("tunnel_address".to_string(), serde_json::json!(address));
    }
    let out = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    std::fs::write(&path, out).map_err(|e| e.to_string())
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

                let _ =
                    patch_mserve_json_tunnel(&directory_path, &handle.tunnel_id, &handle.address);
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

    // Refuse to start over a live process; otherwise drop any stale record. A
    // sleeping entry means the wake listener owns the port — signal it to stop
    // and wait for the port to free before we bind it (this is the "wake" path).
    let sleeping_port = {
        let mut guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
        if let Some(existing) = guard.get_mut(&key) {
            let alive = existing
                .child
                .as_mut()
                .is_some_and(|child| matches!(child.try_wait(), Ok(None)));
            if alive {
                return Err("Server is already running.".to_string());
            }
            let was_sleeping = matches!(existing.state, LifecycleState::Sleeping);
            let port = existing.server_port;
            if let Some(flag) = existing.sleep_stop.take() {
                flag.store(true, std::sync::atomic::Ordering::Relaxed);
            }
            guard.remove(&key);
            was_sleeping.then_some(port)
        } else {
            None
        }
    };
    if let Some(port) = sleeping_port {
        for _ in 0..15 {
            if !probe_port("127.0.0.1", port, Duration::from_millis(200)) {
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }

    let args = resolve_server_start_args(&directory_path, &config);
    let java_executable = resolve_java_executable(&config, java_executable.as_deref())?;
    ensure_java_executable_exists(&java_executable)?;
    let command_str = build_server_start_command(&directory_path, &config, &java_executable);
    eprintln!("[Server] Executing: {command_str}");

    let is_proxy = provider_is_proxy(&config);
    let (host, mut server_port) = resolve_telemetry_target(&config, &directory_path);

    // Sequential port assignment: if the resolved port is already claimed by
    // another active managed server, step up to the next free port and persist
    // the change so future starts and the frontend stay in sync.
    {
        let guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
        if is_port_claimed(&guard, &host, server_port) {
            let next_port = find_next_available_port(&guard, DEFAULT_MC_PORT);
            drop(guard);
            set_server_port(&directory_path, next_port)
                .unwrap_or_else(|e| eprintln!("[Server] Could not update server-port: {e}"));
            patch_mserve_json_port(&directory_path, next_port)
                .unwrap_or_else(|e| eprintln!("[Server] Could not patch mserve.json port: {e}"));
            server_port = next_port;
        }
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

    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let pid = child.id();
    let started_at = chrono::Utc::now();
    let generation = next_generation();
    let server_id = resolve_server_id(&config, &key);
    let provider_version = infer_provider_version(&config);

    let runtime = ServerRuntime {
        directory: directory.clone(),
        child: Some(child),
        stdin,
        pid: Some(pid),
        started_at,
        state: LifecycleState::Starting,
        exit_code: None,
        stderr_tail: VecDeque::new(),
        rcon,
        host,
        server_port,
        is_proxy,
        server_id,
        configured_ram: config.ram,
        provider_version,
        tps_state: TpsCommandState::Unknown,
        latest_sample: None,
        generation,
        stop_requested: false,
        stop_requested_at: None,
        playit_stop: None,
        tunnel_address: None,
        java_executable: Some(java_executable.clone()),
        auto_restart: config.auto_restart,
        ever_online: false,
        sleep_enabled: config.sleep_enabled && !is_proxy,
        sleep_idle_minutes: config.sleep_idle_minutes.unwrap_or(15).max(1),
        sleep_motd: config
            .sleep_motd
            .clone()
            .filter(|motd| !motd.trim().is_empty())
            .unwrap_or_else(default_sleep_motd),
        sleep_requested: false,
        sleep_stop: None,
    };

    {
        let mut guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
        guard.insert(key.clone(), runtime);
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

    // Bring up the playit tunnel (if enabled) off the start path — it provisions
    // over the network and must not block or fail the server start.
    launch_tunnel(
        app.clone(),
        processes.clone(),
        key.clone(),
        directory.clone(),
        &config,
        server_port,
        generation,
    );

    spawn_supervisor(processes, app.clone(), key, generation);

    let _ = app.emit(
        "server-runtime-state",
        ServerRuntimeStateEvent {
            directory,
            state: LifecycleState::Starting,
            pid: Some(pid),
            started_at: Some(started_at.to_rfc3339()),
            exit_code: None,
            stderr_tail: Vec::new(),
            server_port: Some(server_port),
        },
    );

    Ok("Server started.".to_string())
}

#[tauri::command]
pub(in crate::app) fn start_server(
    directory: String,
    java_executable: Option<String>,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    start_server_internal(directory, java_executable, state.processes.clone(), app)
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

/// Flags a runtime as gracefully stopping (idempotent). Already-terminal
/// (offline/crashed) runtimes are left as-is so their state isn't resurrected.
/// True when a console command is a graceful shutdown (`stop`), matching the
/// frontend's `isStopCommand`. Used so a console-typed stop is recorded as a
/// requested close (no crash, no auto-restart). The leading slash is already
/// stripped by the caller.
fn is_stop_command(command: &str) -> bool {
    command.trim().eq_ignore_ascii_case("stop")
}

/// Signals a sleeping server's wake listener to shut down (releasing the port).
/// No-op for a server that isn't sleeping.
fn stop_sleep_listener(runtime: &mut ServerRuntime) {
    if let Some(flag) = runtime.sleep_stop.take() {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Builds an offline `server-runtime-state` event for a directory/port.
fn offline_state_event(directory: String, server_port: u16) -> ServerRuntimeStateEvent {
    ServerRuntimeStateEvent {
        directory,
        state: LifecycleState::Offline,
        pid: None,
        started_at: None,
        exit_code: None,
        stderr_tail: Vec::new(),
        server_port: Some(server_port),
    }
}

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

#[tauri::command]
pub(in crate::app) fn stop_server(
    directory: String,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let key = server_key(&directory);
    let mut guard = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
    let runtime = guard
        .get_mut(&key)
        .ok_or_else(|| "Server is not running.".to_string())?;

    // A sleeping server has no process — just tear the wake listener down and
    // report it offline (this is "stop sleeping").
    if matches!(runtime.state, LifecycleState::Sleeping) {
        stop_sleep_listener(runtime);
        let event = offline_state_event(runtime.directory.clone(), runtime.server_port);
        guard.remove(&key);
        drop(guard);
        let _ = app.emit("server-runtime-state", event);
        return Ok("Server is no longer sleeping.".to_string());
    }

    mark_stopping(runtime);

    // Prefer stdin for owned servers (output shows in the terminal); fall back to
    // RCON for adopted servers. The supervisor detects exit and emits `offline`.
    if send_stop_via_stdin(runtime) {
        return Ok("Stopping server.".to_string());
    }

    let Some(rcon) = runtime.rcon.clone() else {
        return Err(
            "This server was started outside mserve and has no RCON channel — use Force Kill."
                .to_string(),
        );
    };
    let host = runtime.host.clone();
    drop(guard);
    RconClient::connect(&host, rcon.port, &rcon.password, Duration::from_millis(900))
        .and_then(|mut client| client.command("stop"))
        .map_err(|err| format!("Could not reach the server over RCON to stop it ({err})."))?;

    Ok("Stopping server.".to_string())
}

#[tauri::command]
pub(in crate::app) fn restart_server(
    directory: String,
    java_executable: Option<String>,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let key = server_key(&directory);
    let processes = state.processes.clone();

    // Signal a graceful stop on the running process (if any).
    {
        let mut guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
        if let Some(runtime) = guard.get_mut(&key)
            && runtime.child.is_some()
        {
            mark_stopping(runtime);
            send_stop_via_stdin(runtime);
        }
    }

    // Wait for the old process to exit (supervisor escalates to a kill at grace),
    // then start fresh, off the command thread.
    let app_clone = app.clone();
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
        let _ = start_server_internal(directory, java_executable, processes, app_clone);
    });

    Ok("Restarting server.".to_string())
}

#[tauri::command]
pub(in crate::app) fn force_kill_server(
    directory: String,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let key = server_key(&directory);

    // Owned child: kill it directly; the supervisor reports the exit.
    let external = {
        let mut guard = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
        let Some(runtime) = guard.get_mut(&key) else {
            return Ok("No running server process found.".to_string());
        };
        // Sleeping: mserve itself holds the port with the wake listener. Never
        // fall through to the port-kill path (it would target mserve's own PID).
        if matches!(runtime.state, LifecycleState::Sleeping) {
            stop_sleep_listener(runtime);
            let event = offline_state_event(runtime.directory.clone(), runtime.server_port);
            guard.remove(&key);
            drop(guard);
            let _ = app.emit("server-runtime-state", event);
            return Ok("Server is no longer sleeping.".to_string());
        }
        mark_stopping(runtime);
        if let Some(child) = runtime.child.as_mut() {
            kill_child_process_group(child);
            let _ = child.kill();
            return Ok("Server process was force killed.".to_string());
        }
        (runtime.directory.clone(), runtime.server_port)
    };

    // Adopted (externally started) server: we hold no process handle, so kill
    // whatever is actually listening on its port. If nothing is, the process is
    // already gone. Either way the runtime record is stale — drop it and tell
    // the UI the server is offline (the supervisor exits once the entry is gone).
    let (directory, server_port) = external;
    let result = match pid_listening_on_port(server_port) {
        Some(pid) => kill_process_tree(pid)
            .map(|()| format!("Force killed external server process (PID {pid})."))
            .map_err(|err| format!("Could not kill external server process (PID {pid}): {err}")),
        None => Ok("Server process no longer exists — cleared its runtime state.".to_string()),
    };

    if let Ok(mut guard) = state.processes.lock() {
        guard.remove(&key);
    }
    let _ = app.emit(
        "server-runtime-state",
        ServerRuntimeStateEvent {
            directory,
            state: LifecycleState::Offline,
            pid: None,
            started_at: None,
            exit_code: None,
            stderr_tail: Vec::new(),
            server_port: Some(server_port),
        },
    );

    result
}

#[tauri::command]
pub(in crate::app) fn get_running_server_directories(
    state: State<'_, RuntimeState>,
) -> Vec<String> {
    let guard = match state.processes.lock() {
        Ok(g) => g,
        Err(e) => e.into_inner(),
    };
    guard
        .values()
        // Sleeping servers have no live process (just a wake listener), so they
        // don't count toward the "servers are running, close anyway?" warning.
        .filter(|r| r.state.is_active() && !matches!(r.state, LifecycleState::Sleeping))
        .map(|r| r.directory.clone())
        .collect()
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

#[tauri::command]
pub(in crate::app) fn send_server_command(
    directory: String,
    command: String,
    state: State<'_, RuntimeState>,
) -> Result<(), String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let normalized = trimmed.trim_start_matches('/').to_string();

    let key = server_key(&directory);
    let mut guard = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
    let runtime = guard
        .get_mut(&key)
        .ok_or_else(|| "Server is not running.".to_string())?;

    // A console `stop`/`end` is a requested shutdown: mark it so the supervisor
    // treats the ensuing exit as intentional (no `crashed`, no auto-restart).
    if is_stop_command(&normalized) {
        mark_stopping(runtime);
    }

    if let Some(stdin) = runtime.stdin.as_mut() {
        writeln!(stdin, "{normalized}").map_err(|err| err.to_string())?;
        stdin.flush().map_err(|err| err.to_string())?;
        Ok(())
    } else if let Some(rcon) = runtime.rcon.clone() {
        let host = runtime.host.clone();
        drop(guard);
        let mut client =
            RconClient::connect(&host, rcon.port, &rcon.password, Duration::from_millis(900))?;
        client.command(&normalized)?;
        Ok(())
    } else {
        Err("Server is not running.".to_string())
    }
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
    directory_path: PathBuf,
    config: RuntimeServerConfig,
    host: String,
    server_port: u16,
    processes: Processes,
    app: tauri::AppHandle,
) {
    let key = server_key(&directory);
    let is_proxy = provider_is_proxy(&config);
    let rcon = if is_proxy {
        None
    } else {
        read_rcon_config(&directory_path)
    };
    let server_id = resolve_server_id(&config, &key);
    let provider_version = infer_provider_version(&config);
    let generation = next_generation();

    let runtime = ServerRuntime {
        directory,
        child: None,
        stdin: None,
        pid: None,
        started_at: chrono::Utc::now(),
        state: LifecycleState::RunningExternal,
        exit_code: None,
        stderr_tail: VecDeque::new(),
        rcon,
        host,
        server_port,
        is_proxy,
        server_id,
        configured_ram: config.ram,
        provider_version,
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
    };

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
        if is_port_claimed(&guard, &runtime.host, runtime.server_port) {
            return;
        }
        guard.insert(key.clone(), runtime);
    }
    spawn_supervisor(processes, app, key, generation);
}

#[tauri::command]
pub(in crate::app) fn get_server_runtime(
    directory: String,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<ServerRuntimeSnapshot, String> {
    let key = server_key(&directory);
    {
        let guard = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
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
        let guard = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
        if is_port_claimed(&guard, &host, server_port) {
            return Ok(offline_snapshot());
        }
    }

    if probe_port(&host, server_port, Duration::from_millis(400)) {
        register_external(
            directory,
            directory_path,
            config,
            host,
            server_port,
            state.processes.clone(),
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

/// Patches just the `tunnel_enabled` flag in `mserve.json`.
fn patch_mserve_json_tunnel_enabled(
    directory: &std::path::Path,
    enabled: bool,
) -> Result<(), String> {
    let path = directory.join("mserve.json");
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(obj) = value.as_object_mut() {
        obj.insert("tunnel_enabled".to_string(), serde_json::json!(enabled));
    }
    let out = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    std::fs::write(&path, out).map_err(|e| e.to_string())
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

    patch_mserve_json_tunnel_enabled(&directory_path, enabled)?;

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

#[tauri::command]
pub(in crate::app) fn delete_server(
    directory: String,
    state: State<'_, RuntimeState>,
) -> Result<String, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() {
        return Err("Server directory does not exist.".to_string());
    }

    let key = server_key(&directory);
    if let Some(mut runtime) = state
        .processes
        .lock()
        .map_err(|_| "Runtime lock failed.")?
        .remove(&key)
    {
        let _ = terminate_runtime(&mut runtime);
    }

    trash::delete(&directory_path).map_err(|err| err.to_string())?;
    Ok("Server moved to recycle bin.".to_string())
}
