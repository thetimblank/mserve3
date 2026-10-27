use super::super::support::{
    home_dir, move_directory_with_fallback, normalize_auto_backup_modes, normalize_backup_policy,
    normalize_backup_scope, normalize_custom_flags, normalize_provider,
    parse_mserve_top_level_object, patch_mserve_json, sanitize_mserve_value_config, server_key,
    swap_files, write_synced_mserve_json,
};
use super::super::{
    LifecycleState, RuntimeState, UpdateServerSettingsPayload, UpdateServerSettingsResult,
};
use super::run_blocking;
use super::runtime::{emit_offline, release_sleeping};
use serde_json::{Value, json};
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

/// Resolves a server directory that already has an mserve.json.
fn managed_server_directory(directory: &str) -> Result<PathBuf, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }
    if !directory_path.join("mserve.json").exists() {
        return Err("mserve.json not found in server directory.".to_string());
    }
    Ok(directory_path)
}

/// Updates only the backup-related fields in mserve.json (`storage_limit`,
/// `auto_backup`, `auto_backup_interval`, `auto_restart`, retention policy and
/// scope). Does not require the server to be offline so these settings can be
/// changed while the server is running. The retention fields are optional so
/// callers can update triggers without touching policy (and vice versa).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(in crate::app) fn update_server_backup_settings(
    directory: String,
    storage_limit: u32,
    auto_backup: Vec<String>,
    auto_backup_interval: u32,
    auto_restart: bool,
    backup_policy: Option<String>,
    backup_max_count: Option<u32>,
    backup_max_age_days: Option<u32>,
    backup_scope: Option<Vec<String>>,
) -> Result<(), String> {
    let directory_path = managed_server_directory(&directory)?;

    let mut updates: Vec<(&str, Value)> = vec![
        ("storage_limit", json!(storage_limit.max(1))),
        (
            "auto_backup",
            json!(normalize_auto_backup_modes(auto_backup)),
        ),
        ("auto_backup_interval", json!(auto_backup_interval.max(1))),
        ("auto_restart", json!(auto_restart)),
    ];
    if let Some(policy) = backup_policy {
        updates.push((
            "backup_policy",
            json!(normalize_backup_policy(Some(&policy))),
        ));
    }
    if let Some(max_count) = backup_max_count {
        updates.push(("backup_max_count", json!(max_count)));
    }
    if let Some(max_age_days) = backup_max_age_days {
        updates.push(("backup_max_age_days", json!(max_age_days)));
    }
    if let Some(scope) = backup_scope {
        updates.push(("backup_scope", json!(normalize_backup_scope(Some(&scope)))));
    }

    patch_mserve_json(&directory_path, &updates)
}

/// Persists just the per-server Java pin in mserve.json without touching any
/// other settings. Used by the automatic start-failure fallback to remember the
/// Java version that actually worked, and to clear the pin back to automatic.
#[tauri::command]
pub(in crate::app) fn set_server_java_installation(
    directory: String,
    java_installation: Option<String>,
) -> Result<(), String> {
    let directory_path = managed_server_directory(&directory)?;
    let java_installation = java_installation
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    patch_mserve_json(
        &directory_path,
        &[("java_installation", json!(java_installation))],
    )
}

/// Persists just the per-server extra Java flags in mserve.json without touching
/// any other settings. Used by the automatic start-failure fallback to drop a
/// `--nogui` that the server's jar rejects.
#[tauri::command]
pub(in crate::app) fn set_server_custom_flags(
    directory: String,
    custom_flags: Vec<String>,
) -> Result<(), String> {
    let directory_path = managed_server_directory(&directory)?;
    patch_mserve_json(
        &directory_path,
        &[("custom_flags", json!(normalize_custom_flags(custom_flags)))],
    )
}

#[tauri::command]
pub(in crate::app) async fn update_server_settings(
    app: tauri::AppHandle,
    payload: UpdateServerSettingsPayload,
    state: State<'_, RuntimeState>,
) -> Result<UpdateServerSettingsResult, String> {
    let current_directory = payload.directory.trim().to_string();
    if current_directory.is_empty() {
        return Err("Server directory is required.".to_string());
    }

    let key = server_key(&current_directory);
    let sleeping_generation = {
        let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
        match processes.get_mut(&key) {
            Some(existing) => {
                let alive = existing
                    .child
                    .as_mut()
                    .is_some_and(|child| matches!(child.try_wait(), Ok(None)));
                let active = alive
                    || matches!(
                        existing.state,
                        LifecycleState::Starting
                            | LifecycleState::Online
                            | LifecycleState::Stopping
                            | LifecycleState::RunningExternal
                    );
                if active {
                    return Err("Server must be offline before editing settings.".to_string());
                }
                if existing.state == LifecycleState::Sleeping {
                    // Torn down only once the update succeeds (below), so a
                    // failed edit leaves the server asleep and wakeable.
                    Some(existing.generation)
                } else {
                    processes.remove(&key);
                    None
                }
            }
            None => None,
        }
    };

    let directory = current_directory.clone();
    let result = run_blocking(move || update_server_settings_blocking(&directory, payload)).await?;

    // A sleeping server's wake listener (and tunnel) would keep the port and
    // wake the old configuration, so shut them down now that it's changed.
    if let Some(generation) = sleeping_generation {
        let released = {
            let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
            match processes.get_mut(&key) {
                Some(existing)
                    if existing.generation == generation
                        && existing.state == LifecycleState::Sleeping =>
                {
                    let event = release_sleeping(existing);
                    processes.remove(&key);
                    Some(event)
                }
                _ => None,
            }
        };
        if let Some(event) = released {
            emit_offline(&app, event);
        }
    }

    Ok(result)
}

fn update_server_settings_blocking(
    current_directory: &str,
    payload: UpdateServerSettingsPayload,
) -> Result<UpdateServerSettingsResult, String> {
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

    config.auto_backup = normalize_auto_backup_modes(payload.auto_backup);

    let custom_flags = normalize_custom_flags(payload.custom_flags);

    config.ram = payload.ram.max(0.25);
    config.storage_limit = payload.storage_limit.max(1);
    config.auto_backup_interval = payload.auto_backup_interval.max(1);
    config.auto_restart = payload.auto_restart;
    config.sleep_enabled = payload.sleep_enabled;
    config.sleep_idle_minutes = payload
        .sleep_idle_minutes
        .unwrap_or(config.sleep_idle_minutes)
        .max(1);
    // Kept verbatim — leading spaces are the MOTD editor's alignment padding.
    config.sleep_motd = payload
        .sleep_motd
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map_or(config.sleep_motd, str::to_string);
    if let Some(policy) = payload.backup_policy.as_deref() {
        config.backup_policy = normalize_backup_policy(Some(policy));
    }
    if let Some(max_count) = payload.backup_max_count {
        config.backup_max_count = max_count;
    }
    if let Some(max_age_days) = payload.backup_max_age_days {
        config.backup_max_age_days = max_age_days;
    }
    if let Some(scope) = payload.backup_scope.as_deref() {
        config.backup_scope = normalize_backup_scope(Some(scope));
    }
    config.custom_flags = custom_flags;
    config.java_installation = payload
        .java_installation
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    config.provider = normalize_provider(&payload.provider, &config.file);
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
        telemetry_host: config.telemetry_host,
        telemetry_port: config.telemetry_port,
    })
}
