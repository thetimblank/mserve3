use super::super::support::*;
use super::super::*;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use tauri::State;

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
    let mut config: serde_json::Value = serde_json::from_str(&config_text).map_err(|err| err.to_string())?;
    let object = config
        .as_object_mut()
        .ok_or_else(|| "Invalid mserve.json format.".to_string())?;

    let file_name = object
        .get("file")
        .and_then(|value| value.as_str())
        .unwrap_or("server.jar")
        .trim()
        .to_string();

    if file_name.is_empty() {
        return Err("Invalid server jar file in mserve.json.".to_string());
    }

    if let Some(raw_swap_path) = payload.jar_swap_path.as_deref() {
        let swap_path = raw_swap_path.trim();
        if !swap_path.is_empty() {
            if !swap_path.to_lowercase().ends_with(".jar") {
                return Err("Selected file must be a .jar file.".to_string());
            }
            let current_jar = directory_path.join(&file_name);
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

    let auto_backup: Vec<String> = payload
        .auto_backup
        .into_iter()
        .filter(|value| matches!(value.as_str(), "interval" | "on_close" | "on_start"))
        .collect();

    object.insert("ram".to_string(), json!(payload.ram.max(1)));
    object.insert(
        "auto_backup_interval".to_string(),
        json!(payload.auto_backup_interval.max(1)),
    );
    object.insert("auto_backup".to_string(), json!(auto_backup));
    object.insert("auto_restart".to_string(), json!(payload.auto_restart));
    object.insert(
        "directory".to_string(),
        json!(directory_path.to_string_lossy().to_string()),
    );

    let final_mserve_path = directory_path.join("mserve.json");
    fs::write(
        &final_mserve_path,
        serde_json::to_vec_pretty(&config).map_err(|err| err.to_string())?,
    )
    .map_err(|err| err.to_string())?;

    Ok(UpdateServerSettingsResult {
        directory: directory_path.to_string_lossy().to_string(),
        file: file_name,
    })
}

