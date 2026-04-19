use super::super::support::*;
use super::super::*;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::State;

fn resolve_server_start_args(config: &RuntimeServerConfig) -> Vec<String> {
    let file = if config.file.trim().is_empty() {
        "server.jar".to_string()
    } else {
        config.file.trim().to_string()
    };

    let mut args = vec![
        format!("-Xmx{}G", config.ram.unwrap_or(4).max(1)),
        format!("-Xms{}G", config.ram.unwrap_or(4).max(1)),
        "-jar".to_string(),
        file,
    ];

    args.extend(config.custom_flags.clone().unwrap_or_default());
    args
}

fn resolve_java_executable(config: &RuntimeServerConfig, global_java_installation: Option<&str>) -> String {
    if let Some(server_java) = config
        .java_installation
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return server_java.to_string();
    }

    if let Some(global_java) = global_java_installation
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return global_java.to_string();
    }

    "java".to_string()
}

fn build_server_start_command(config: &RuntimeServerConfig, java_executable: &str) -> String {
    let args = resolve_server_start_args(config);
    format!("{} {}", java_executable, args.join(" "))
}

#[tauri::command]
pub(in crate::app) fn start_server(
    directory: String,
    global_java_installation: Option<String>,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let config = get_runtime_config(&directory_path)?;

    let key = server_key(&directory);
    {
        let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
        let mut should_remove_stale = false;

        if let Some(existing) = processes.get_mut(&key) {
            match existing.child.try_wait() {
                Ok(None) => return Err("Server is already running.".to_string()),
                _ => should_remove_stale = true,
            }
        }

        if should_remove_stale {
            processes.remove(&key);
        }
    }

    let args = resolve_server_start_args(&config);
    let java_executable = resolve_java_executable(&config, global_java_installation.as_deref());
    let command_str = build_server_start_command(&config, &java_executable);
    eprintln!("[Server] Executing: {}", command_str);

    let mut child = Command::new(&java_executable)
        .args(args)
        .current_dir(&directory_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start java process: {err}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open server stdin.".to_string())?;

    if let Some(stdout) = child.stdout.take() {
        emit_output_reader(stdout, directory.clone(), "stdout", app.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        emit_output_reader(stderr, directory.clone(), "stderr", app.clone());
    }

    let pid = child.id();
    let started_at = chrono::Utc::now();

    let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
    processes.insert(
        key,
        RunningServerProcess {
            child,
            stdin,
            pid,
            started_at,
        },
    );

    Ok("Server started.".to_string())
}

#[tauri::command]
pub(in crate::app) fn get_server_start_command(
    directory: String,
    global_java_installation: Option<String>,
) -> Result<String, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let config = get_runtime_config(&directory_path)?;
    let java_executable = resolve_java_executable(&config, global_java_installation.as_deref());
    Ok(build_server_start_command(&config, &java_executable))
}

#[tauri::command]
pub(in crate::app) fn stop_server(directory: String, state: State<'_, RuntimeState>) -> Result<String, String> {
    let key = server_key(&directory);
    let mut process = {
        let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
        processes
            .remove(&key)
            .ok_or_else(|| "Server is not running.".to_string())?
    };

    stop_child_process(&mut process)?;
    Ok("Server stopped.".to_string())
}

#[tauri::command]
pub(in crate::app) fn force_kill_server(
    directory: String,
    state: State<'_, RuntimeState>,
) -> Result<String, String> {
    let key = server_key(&directory);
    let maybe_process = {
        let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
        processes.remove(&key)
    };

    let Some(mut process) = maybe_process else {
        return Ok("No running server process found.".to_string());
    };

    match process.child.try_wait().map_err(|err| err.to_string())? {
        Some(_) => Ok("Server process already exited.".to_string()),
        None => {
            process.child.kill().map_err(|err| err.to_string())?;
            process.child.wait().map_err(|err| err.to_string())?;
            Ok("Server process was force killed.".to_string())
        }
    }
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

    let normalized = trimmed.trim_start_matches('/');

    let key = server_key(&directory);
    let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
    let process = processes
        .get_mut(&key)
        .ok_or_else(|| "Server is not running.".to_string())?;

    if process.child.try_wait().map_err(|err| err.to_string())?.is_some() {
        processes.remove(&key);
        return Err("Server is not running.".to_string());
    }

    writeln!(process.stdin, "{normalized}").map_err(|err| err.to_string())?;
    process.stdin.flush().map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub(in crate::app) fn get_server_runtime_status(
    directory: String,
    state: State<'_, RuntimeState>,
) -> Result<RuntimeStatusResult, String> {
    let key = server_key(&directory);
    let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;

    let Some(process) = processes.get_mut(&key) else {
        return Ok(RuntimeStatusResult {
            running: false,
            exit_code: None,
        });
    };

    match process.child.try_wait().map_err(|err| err.to_string())? {
        None => Ok(RuntimeStatusResult {
            running: true,
            exit_code: None,
        }),
        Some(status) => {
            let code = status.code();
            processes.remove(&key);
            Ok(RuntimeStatusResult {
                running: false,
                exit_code: code,
            })
        }
    }
}


#[tauri::command]
pub(in crate::app) fn delete_server(directory: String, state: State<'_, RuntimeState>) -> Result<String, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() {
        return Err("Server directory does not exist.".to_string());
    }

    let key = server_key(&directory);
    if let Some(mut process) = state
        .processes
        .lock()
        .map_err(|_| "Runtime lock failed.")?
        .remove(&key)
    {
        stop_child_process(&mut process)?;
    }

    trash::delete(&directory_path).map_err(|err| err.to_string())?;
    Ok("Server moved to recycle bin.".to_string())
}

