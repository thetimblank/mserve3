use super::super::support::*;
use super::super::*;
use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, State};

/// Formats a heap size (in gigabytes, fractional allowed) into a JVM size token.
/// Whole gigabytes use the `G` suffix; sub-gigabyte values fall back to `M` so
/// values like 0.5 GB are emitted as `512M` (the JVM rejects fractional `G`).
fn format_heap_size(ram_gb: f64) -> String {
    let megabytes = (ram_gb.max(0.25) * 1024.0).round() as u64;
    if megabytes % 1024 == 0 {
        format!("{}G", megabytes / 1024)
    } else {
        format!("{}M", megabytes)
    }
}

fn resolve_server_start_args(config: &RuntimeServerConfig) -> Vec<String> {
    let file = if config.file.trim().is_empty() {
        "server.jar".to_string()
    } else {
        config.file.trim().to_string()
    };

    let heap = format_heap_size(config.ram.unwrap_or(4.0));
    let mut args = vec![
        format!("-Xmx{heap}"),
        format!("-Xms{heap}"),
        "-jar".to_string(),
        file,
    ];

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
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Ok(server_java.to_string());
    }

    if let Some(resolved) = java_executable
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Ok(resolved.to_string());
    }

    Err(NO_JAVA_ERROR.to_string())
}

fn build_server_start_command(config: &RuntimeServerConfig, java_executable: &str) -> String {
    let args = resolve_server_start_args(config);
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

/// Core start routine, shared by the `start_server` command and the restart flow.
fn start_server_internal(
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

    // Refuse to start over a live process; otherwise drop any stale record.
    {
        let mut guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
        if let Some(existing) = guard.get_mut(&key) {
            let alive = existing
                .child
                .as_mut()
                .map(|child| matches!(child.try_wait(), Ok(None)))
                .unwrap_or(false);
            if alive {
                return Err("Server is already running.".to_string());
            }
            guard.remove(&key);
        }
    }

    let args = resolve_server_start_args(&config);
    let java_executable = resolve_java_executable(&config, java_executable.as_deref())?;
    ensure_java_executable_exists(&java_executable)?;
    let command_str = build_server_start_command(&config, &java_executable);
    eprintln!("[Server] Executing: {}", command_str);

    let is_proxy = provider_is_proxy(&config);
    let (host, server_port) = resolve_telemetry_target(&config, &directory_path);
    // Provision a reliable RCON channel for non-proxy servers.
    let rcon = if is_proxy {
        None
    } else {
        ensure_rcon_enabled(&directory_path).ok()
    };

    let mut child = no_window_command(&java_executable)
        .args(args)
        .current_dir(&directory_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start java process: {err}"))?;

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
    Ok(build_server_start_command(&config, &java_executable))
}

#[tauri::command]
pub(in crate::app) fn stop_server(
    directory: String,
    state: State<'_, RuntimeState>,
) -> Result<String, String> {
    let key = server_key(&directory);
    let mut guard = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
    let runtime = guard
        .get_mut(&key)
        .ok_or_else(|| "Server is not running.".to_string())?;

    runtime.stop_requested = true;
    runtime.stop_requested_at = Some(Instant::now());
    if !matches!(runtime.state, LifecycleState::Offline | LifecycleState::Crashed) {
        runtime.state = LifecycleState::Stopping;
    }

    // Prefer stdin for owned servers (output shows in the terminal); fall back to
    // RCON for adopted servers. The supervisor detects exit and emits `offline`.
    if let Some(stdin) = runtime.stdin.as_mut() {
        let _ = writeln!(stdin, "stop");
        let _ = stdin.flush();
    } else if let Some(rcon) = runtime.rcon.clone() {
        let host = runtime.host.clone();
        drop(guard);
        let _ = RconClient::connect(&host, rcon.port, &rcon.password, Duration::from_millis(900))
            .and_then(|mut client| client.command("stop"));
    }

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
        if let Some(runtime) = guard.get_mut(&key) {
            if runtime.child.is_some() {
                runtime.stop_requested = true;
                runtime.stop_requested_at = Some(Instant::now());
                runtime.state = LifecycleState::Stopping;
                if let Some(stdin) = runtime.stdin.as_mut() {
                    let _ = writeln!(stdin, "stop");
                    let _ = stdin.flush();
                }
            }
        }
    }

    // Wait for the old process to exit (supervisor escalates to a kill at grace),
    // then start fresh, off the command thread.
    let app_clone = app.clone();
    std::thread::spawn(move || {
        for _ in 0..200 {
            let done = match processes.lock() {
                Ok(guard) => guard.get(&key).map(|rt| rt.child.is_none()).unwrap_or(true),
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
) -> Result<String, String> {
    let key = server_key(&directory);
    let mut guard = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
    let Some(runtime) = guard.get_mut(&key) else {
        return Ok("No running server process found.".to_string());
    };

    runtime.stop_requested = true;
    runtime.stop_requested_at = Some(Instant::now());
    if runtime.state != LifecycleState::Offline {
        runtime.state = LifecycleState::Stopping;
    }

    match runtime.child.as_mut() {
        Some(child) => {
            let _ = child.kill();
            Ok("Server process was force killed.".to_string())
        }
        None => Ok("Server process is not owned by mserve.".to_string()),
    }
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
        .filter(|r| !matches!(r.state, LifecycleState::Offline | LifecycleState::Crashed))
        .map(|r| r.directory.clone())
        .collect()
}

#[tauri::command]
pub(in crate::app) fn force_kill_all_servers(
    state: State<'_, RuntimeState>,
) -> Result<(), String> {
    let mut guard = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
    for runtime in guard.values_mut() {
        runtime.stop_requested = true;
        runtime.stop_requested_at = Some(Instant::now());
        if runtime.state != LifecycleState::Offline {
            runtime.state = LifecycleState::Stopping;
        }
        if let Some(child) = runtime.child.as_mut() {
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
    };

    {
        let Ok(mut guard) = processes.lock() else {
            return;
        };
        if guard.contains_key(&key) {
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
        });
    }

    Ok(offline_snapshot())
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
