use super::super::support::*;
use super::super::*;
use std::fs;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub(in crate::app) fn get_default_servers_root_path() -> Result<String, String> {
    Ok(home_dir()
        .join("mserve")
        .join("servers")
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub(in crate::app) fn update_server_settings(
    payload: UpdateServerSettingsPayload,
    state: State<'_, RuntimeState>,
) -> Result<UpdateServerSettingsResult, String> {
    let current_directory = payload.directory.trim();
    if current_directory.is_empty() {
        return Err("Server directory is required.".to_string());
    }

    let key = server_key(current_directory);
    {
        let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
        if let Some(existing) = processes.get_mut(&key) {
            if existing.child.try_wait().map_err(|err| err.to_string())?.is_none() {
                return Err("Server must be offline before editing settings.".to_string());
            }
            processes.remove(&key);
        }
    }

    let mut directory_path = PathBuf::from(current_directory);
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let mserve_path = directory_path.join("mserve.json");
    if !mserve_path.exists() {
        return Err("mserve.json not found in server directory.".to_string());
    }

    let config_text = fs::read_to_string(&mserve_path).map_err(|err| err.to_string())?;
    let object = parse_mserve_top_level_object(&config_text)
        .map_err(|_| "Invalid mserve.json format.".to_string())?;

    let mut config = sanitize_mserve_value_config(&directory_path, &object);
    if config.file.trim().is_empty() {
        return Err("Invalid server jar file in mserve.json.".to_string());
    }

    if let Some(raw_swap_path) = payload.jar_swap_path.as_deref() {
        let swap_path = raw_swap_path.trim();
        if !swap_path.is_empty() {
            if !swap_path.to_lowercase().ends_with(".jar") {
                return Err("Selected file must be a .jar file.".to_string());
            }
            let current_jar = directory_path.join(&config.file);
            let selected_jar = PathBuf::from(swap_path);
            swap_files(&current_jar, &selected_jar)?;
        }
    }

    if let Some(new_directory_raw) = payload.new_directory.as_deref() {
        let target_trimmed = new_directory_raw.trim();
        if !target_trimmed.is_empty() {
            let target_directory = PathBuf::from(target_trimmed);
            if directory_path != target_directory {
                if target_directory.exists() {
                    return Err("Target server directory already exists.".to_string());
                }

                move_directory_with_fallback(&directory_path, &target_directory)?;
                directory_path = target_directory;
            }
        }
    }

    config.auto_backup = payload
        .auto_backup
        .into_iter()
        .filter(|value| matches!(value.as_str(), "interval" | "on_close" | "on_start"))
        .collect();

    let custom_flags = normalize_custom_flags(payload.custom_flags);

    config.ram = payload.ram.max(1);
    config.storage_limit = payload.storage_limit.max(1);
    config.auto_backup_interval = payload.auto_backup_interval.max(1);
    config.auto_restart = payload.auto_restart;
    config.custom_flags = custom_flags;
    config.java_installation = payload
        .java_installation
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    config.provider = payload
        .provider
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| infer_provider_from_jar_file(&config.file));
    config.version = payload
        .version
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| infer_version_from_jar_file(&config.file));
    config.provider_checks = payload.provider_checks;
    config.telemetry_host = payload
        .telemetry_host
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| config.telemetry_host.clone());
    config.telemetry_port = payload
        .telemetry_port
        .filter(|value| *value > 0)
        .unwrap_or(config.telemetry_port);

    write_synced_mserve_json(&directory_path, &config)?;

    Ok(UpdateServerSettingsResult {
        directory: directory_path.to_string_lossy().to_string(),
        file: config.file,
        provider: config.provider,
        version: config.version,
        provider_checks: config.provider_checks,
        telemetry_host: config.telemetry_host,
        telemetry_port: config.telemetry_port,
    })
}

