use super::super::support::*;
use super::super::*;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::State;

#[tauri::command]
pub(in crate::app) fn start_server(
    directory: String,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let config = get_runtime_config(&directory_path)?;
    let file = if config.file.trim().is_empty() {
        "server.jar".to_string()
    } else {
        config.file.trim().to_string()
    };

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

    let custom_flags = config.custom_flags.unwrap_or_default();

    let mut args = vec![
        format!("-Xms{}G", config.ram.unwrap_or(3).max(1)),
        format!("-Xmx{}G", config.ram.unwrap_or(3).max(1)),
        "-jar".to_string(),
        file,
    ];
    args.extend(custom_flags);
    args.push("--nogui".to_string());

    let command_str = format!("java {}", args.join(" "));
    eprintln!("[Server] Executing: {}", command_str);

    let mut child = Command::new("java")
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
        drain_reader(stderr);
    }

    let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
    processes.insert(key, RunningServerProcess { child, stdin });

    Ok("Server started.".to_string())
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

