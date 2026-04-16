use super::super::support::*;
use super::super::*;
use serde_json::json;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub(in crate::app) fn initialize_server(payload: InitServerPayload) -> Result<InitServerResult, String> {
    let directory_str = payload.directory.trim();
    if directory_str.is_empty() {
        return Ok(InitServerResult {
            ok: false,
            message: "Server directory is required.".to_string(),
            id: String::new(),
            file: payload.file,
            directory: payload.directory,
        });
    }

    let directory = PathBuf::from(directory_str);

    if !directory.exists() {
        if !payload.create_directory_if_missing {
            return Ok(InitServerResult {
                ok: false,
                message: "Directory does not exist. Enable 'Create directory if it doesn't exist' or choose another path.".to_string(),
                id: String::new(),
                file: payload.file,
                directory: directory_str.to_string(),
            });
        }

        fs::create_dir_all(&directory).map_err(|err| err.to_string())?;
    }

    if directory.join("mserve.json").exists() || directory.join("server.properties").exists() {
        return Ok(InitServerResult {
            ok: false,
            message: "There is already a server in this location.".to_string(),
            id: String::new(),
            file: payload.file,
            directory: directory_str.to_string(),
        });
    }

    let auto_backup: Vec<String> = payload
        .auto_backup
        .into_iter()
        .filter(|value| matches!(value.as_str(), "interval" | "on_close" | "on_start"))
        .collect();

    // Copy the jar file to the server directory
    let (resolved_file, copy_message) = copy_jar_to_server_directory(&directory, payload.file.trim())?;
    let server_id = generate_server_id();

    let content = json!({
        "id": server_id,
        "explicit_info_names": false,
        "auto_backup": auto_backup,
        "ram": payload.ram.max(1),
        "directory": directory_str,
        "file": resolved_file.clone(),
        "auto_backup_interval": payload.auto_backup_interval.max(1),
        "auto_restart": payload.auto_restart,
        "createdAt": chrono::Local::now().to_rfc3339(),
    });

    let mserve_file = directory.join("mserve.json");
    fs::write(mserve_file, serde_json::to_vec_pretty(&content).map_err(|err| err.to_string())?)
        .map_err(|err| err.to_string())?;

    if payload.auto_agree_eula {
        write_eula(&directory)?;
    }

    Ok(InitServerResult {
        ok: true,
        message: format!("Initialization complete. {copy_message}"),
        id: server_id,
        file: resolved_file,
        directory: directory_str.to_string(),
    })
}

#[tauri::command]
pub(in crate::app) fn import_server(directory: String) -> Result<InitServerResult, String> {
    let directory_str = directory.trim();
    if directory_str.is_empty() {
        return Ok(InitServerResult {
            ok: false,
            message: "Server directory is required.".to_string(),
            id: String::new(),
            file: String::new(),
            directory: directory.clone(),
        });
    }

    let directory_path = PathBuf::from(directory_str);
    
    if !directory_path.exists() {
        return Ok(InitServerResult {
            ok: false,
            message: "Directory does not exist.".to_string(),
            id: String::new(),
            file: String::new(),
            directory: directory_str.to_string(),
        });
    }
    
    if !directory_path.is_dir() {
        return Ok(InitServerResult {
            ok: false,
            message: "Path is not a directory.".to_string(),
            id: String::new(),
            file: String::new(),
            directory: directory_str.to_string(),
        });
    }

    // Check if mserve.json already exists
    let mserve_json_path = directory_path.join("mserve.json");

    let (server_id, jar_file, message) = if mserve_json_path.exists() {
        let detected = find_first_jar_file_name(&directory_path).unwrap_or_default();
        let resolved_id = fs::read_to_string(&mserve_json_path)
            .ok()
            .and_then(|raw| parse_mserve_top_level_object(&raw).ok())
            .map(|object| sanitize_mserve_value_config(&directory_path, &object).id)
            .unwrap_or_else(generate_server_id);
        (
            resolved_id,
            detected,
            "Server already has mserve.json configuration. It will be validated and synced on import.".to_string(),
        )
    } else {
        let mut found_jar = String::new();

        if let Ok(entries) = fs::read_dir(&directory_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(filename) = path.file_name().and_then(|name| name.to_str()) {
                        if filename.to_lowercase().ends_with(".jar") {
                            found_jar = filename.to_string();
                            break;
                        }
                    }
                }
            }
        }

        if found_jar.is_empty() {
            return Ok(InitServerResult {
                ok: false,
                message: "No jar file found in server directory. Please add a server.jar file first.".to_string(),
                id: String::new(),
                file: String::new(),
                directory: directory_str.to_string(),
            });
        }

        let server_id = generate_server_id();

        let content = json!({
            "id": server_id,
            "explicit_info_names": false,
            "auto_backup": [],
            "ram": 3,
            "directory": directory_str,
            "file": found_jar.clone(),
            "auto_backup_interval": 120,
            "auto_restart": false,
            "createdAt": chrono::Local::now().to_rfc3339(),
        });

        fs::write(&mserve_json_path, serde_json::to_vec_pretty(&content).map_err(|err| err.to_string())?)
            .map_err(|err| err.to_string())?;

        (
            server_id,
            found_jar.clone(),
            format!("Created mserve.json with default settings. Found jar file: {}", found_jar),
        )
    };

    Ok(InitServerResult {
        ok: true,
        message,
        id: server_id,
        file: jar_file,
        directory: directory_str.to_string(),
    })
}

#[tauri::command]
pub(in crate::app) fn sync_server_mserve_json(directory: String) -> Result<SyncMserveJsonResult, String> {
    let directory_str = directory.trim();
    if directory_str.is_empty() {
        return Err("Server directory is required.".to_string());
    }

    let directory_path = PathBuf::from(directory_str);
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let mserve_path = directory_path.join("mserve.json");
    if !mserve_path.exists() {
        return Ok(SyncMserveJsonResult {
            status: "needs_setup".to_string(),
            message: "mserve.json is missing and needs to be rebuilt.".to_string(),
            config: Some(default_synced_config(&directory_path)),
            updated: false,
        });
    }

    let raw = fs::read_to_string(&mserve_path).map_err(|err| err.to_string())?;
    let object = match parse_mserve_top_level_object(&raw) {
        Ok(value) => value,
        Err(_) => {
            return Ok(SyncMserveJsonResult {
                status: "needs_setup".to_string(),
                message: "The data found was invalid. Please rebuild mserve.json.".to_string(),
                config: Some(default_synced_config(&directory_path)),
                updated: false,
            });
        }
    };

    if validate_mserve_json_keys(&object).is_err() {
        return Ok(SyncMserveJsonResult {
            status: "needs_setup".to_string(),
            message: "The data found was invalid. Please rebuild mserve.json.".to_string(),
            config: Some(default_synced_config(&directory_path)),
            updated: false,
        });
    }

    let normalized = sanitize_mserve_value_config(&directory_path, &object);
    let normalized_json = serde_json::to_string_pretty(&json!({
        "id": normalized.id,
        "explicit_info_names": normalized.explicit_info_names,
        "auto_backup": normalized.auto_backup,
        "ram": normalized.ram,
        "directory": normalized.directory,
        "file": normalized.file,
        "auto_backup_interval": normalized.auto_backup_interval,
        "auto_restart": normalized.auto_restart,
        "custom_flags": normalized.custom_flags,
        "provider": normalized.provider,
        "version": normalized.version,
        "createdAt": normalized.created_at,
    }))
    .map_err(|err| err.to_string())?;

    let existing_trimmed = raw.trim();
    let normalized_trimmed = normalized_json.trim();
    let updated = existing_trimmed != normalized_trimmed;

    if updated {
        write_synced_mserve_json(&directory_path, &normalized)?;
    }

    Ok(SyncMserveJsonResult {
        status: "synced".to_string(),
        message: if updated {
            "mserve.json was validated and repaired.".to_string()
        } else {
            "mserve.json is valid.".to_string()
        },
        config: Some(normalized),
        updated,
    })
}

#[tauri::command]
pub(in crate::app) fn repair_server_mserve_json(payload: RepairMserveJsonPayload) -> Result<SyncMserveJsonResult, String> {
    let directory_str = payload.directory.trim();
    if directory_str.is_empty() {
        return Err("Server directory is required.".to_string());
    }

    let directory_path = PathBuf::from(directory_str);
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let resolved_file = resolve_repair_file(&directory_path, &payload.file)?;
    let auto_backup: Vec<String> = payload
        .auto_backup
        .into_iter()
        .filter(|value| matches!(value.as_str(), "interval" | "on_close" | "on_start"))
        .collect();

    let existing_id = fs::read_to_string(directory_path.join("mserve.json"))
        .ok()
        .and_then(|raw| parse_mserve_top_level_object(&raw).ok())
        .and_then(|object| {
            object
                .get("id")
                .and_then(|value| value.as_str())
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
        })
        .unwrap_or_else(generate_server_id);

    let config = SyncedMserveConfig {
        id: existing_id,
        directory: directory_path.to_string_lossy().to_string(),
        file: resolved_file,
        ram: payload.ram.max(1),
        auto_backup,
        auto_backup_interval: payload.auto_backup_interval.max(1),
        auto_restart: payload.auto_restart,
        explicit_info_names: payload.explicit_info_names,
        custom_flags: payload.custom_flags,
        provider: None,
        version: None,
        created_at: chrono::Local::now().to_rfc3339(),
    };

    write_synced_mserve_json(&directory_path, &config)?;

    Ok(SyncMserveJsonResult {
        status: "synced".to_string(),
        message: "mserve.json was rebuilt successfully.".to_string(),
        config: Some(config),
        updated: true,
    })
}

