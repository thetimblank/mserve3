use super::super::support::*;
use super::super::*;
use std::path::PathBuf;
use std::time::Duration;
use tauri::async_runtime::spawn_blocking;
use tauri::State;

#[tauri::command]
pub(in crate::app) async fn get_server_telemetry(
    directory: String,
    state: State<'_, RuntimeState>,
) -> Result<ServerTelemetryResult, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let config = get_runtime_config(&directory_path)?;
    let provider_checks = config
        .provider_checks
        .clone()
        .unwrap_or_else(default_provider_checks);
    let (telemetry_host, telemetry_port) = resolve_telemetry_target(&config, &directory_path);

    let should_ping = provider_checks.online_polling
        || provider_checks.list_polling
        || provider_checks.version_polling;
    let ping_task = if should_ping {
        let ping_host = telemetry_host.clone();
        Some(spawn_blocking(move || {
            collect_status_ping(&ping_host, telemetry_port, Duration::from_millis(650))
        }))
    } else {
        None
    };

    let mut uptime: Option<String> = None;
    let mut process_pid: Option<u32> = None;

    let key = server_key(&directory);
    {
        let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;

        if let Some(process) = processes.get_mut(&key) {
            match process.child.try_wait().map_err(|err| err.to_string())? {
                None => {
                    uptime = Some(process.started_at.to_rfc3339());
                    process_pid = Some(process.pid);
                }
                Some(_) => {
                    let exited_pid = process.pid;
                    processes.remove(&key);
                    clear_process_metrics_cache(exited_pid);
                }
            }
        }
    }

    let metrics_task = if let Some(pid) = process_pid {
        if provider_checks.ram_polling || provider_checks.cpu_polling {
            let configured_ram = config.ram;
            Some(spawn_blocking(move || {
                collect_process_metrics_cached(pid, configured_ram, Duration::from_secs(12))
            }))
        } else {
            None
        }
    } else {
        None
    };

    let status_ping = if let Some(task) = ping_task {
        task.await.map_err(|err| err.to_string())?
    } else {
        StatusPingResult::default()
    };

    let mut process_metrics = if let Some(task) = metrics_task {
        task.await.map_err(|err| err.to_string())?
    } else {
        ProcessMetricsResult::default()
    };

    if !provider_checks.ram_polling {
        process_metrics.ram_used = None;
    }
    if !provider_checks.cpu_polling {
        process_metrics.cpu_used = None;
    }

    let provider_version = if provider_checks.provider_polling {
        infer_provider_version(&config)
    } else {
        None
    };

    Ok(ServerTelemetryResult {
        online: status_ping.online,
        players_online: status_ping.players_online,
        players_max: status_ping.players_max,
        server_version: status_ping.server_version,
        provider_version,
        tps: None,
        ram_used: process_metrics.ram_used,
        cpu_used: process_metrics.cpu_used,
        uptime,
    })
}
