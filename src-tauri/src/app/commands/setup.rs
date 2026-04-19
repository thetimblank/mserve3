use super::super::support::*;
use super::super::*;
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
    let inferred_provider = infer_provider_from_jar_file(&resolved_file);
    let inferred_version = infer_version_from_jar_file(&resolved_file);

    let config = SyncedMserveConfig {
        id: server_id.clone(),
        file: resolved_file.clone(),
        ram: payload.ram.max(1),
        storage_limit: payload.storage_limit.max(1),
        auto_backup,
        auto_backup_interval: payload.auto_backup_interval.max(1),
        auto_restart: payload.auto_restart,
        custom_flags: default_custom_flags(),
        java_installation: payload
            .java_installation
            .as_deref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        provider: payload
            .provider
            .as_deref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or(inferred_provider),
        version: payload
            .version
            .as_deref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or(inferred_version),
        provider_checks: default_provider_checks(),
        telemetry_host: default_telemetry_host(),
        telemetry_port: detect_default_telemetry_port(&directory),
        created_at: chrono::Local::now().to_rfc3339(),
    };

    write_synced_mserve_json(&directory, &config)?;

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
pub(in crate::app) fn inspect_server_directory(
    directory: String,
    create_directory_if_missing: bool,
) -> Result<ServerDirectoryInspectionResult, String> {
    let directory_str = directory.trim();
    if directory_str.is_empty() {
        return Ok(ServerDirectoryInspectionResult {
            kind: "empty_input".to_string(),
            exists: false,
            is_directory: false,
            is_empty: true,
            has_mserve_json: false,
            has_server_properties: false,
            has_eula_txt: false,
            first_jar_file: None,
            message: "Please choose a server directory.".to_string(),
        });
    }

    let directory_path = PathBuf::from(directory_str);

    if !directory_path.exists() {
        if !create_directory_if_missing {
            return Ok(ServerDirectoryInspectionResult {
                kind: "missing_directory".to_string(),
                exists: false,
                is_directory: false,
                is_empty: true,
                has_mserve_json: false,
                has_server_properties: false,
                has_eula_txt: false,
                first_jar_file: None,
                message:
                    "Directory does not exist. Enable 'Create directory if it doesn't exist' or choose another path."
                        .to_string(),
            });
        }

        return Ok(ServerDirectoryInspectionResult {
            kind: "new_directory".to_string(),
            exists: false,
            is_directory: false,
            is_empty: true,
            has_mserve_json: false,
            has_server_properties: false,
            has_eula_txt: false,
            first_jar_file: None,
            message: "Directory will be created during setup.".to_string(),
        });
    }

    if !directory_path.is_dir() {
        return Ok(ServerDirectoryInspectionResult {
            kind: "not_directory".to_string(),
            exists: true,
            is_directory: false,
            is_empty: false,
            has_mserve_json: false,
            has_server_properties: false,
            has_eula_txt: false,
            first_jar_file: None,
            message: "Server location must be a directory.".to_string(),
        });
    }

    let mut has_mserve_json = false;
    let mut has_server_properties = false;
    let mut has_eula_txt = false;
    let mut first_jar_file: Option<String> = None;
    let mut entry_count = 0usize;

    if let Ok(entries) = fs::read_dir(&directory_path) {
        for entry in entries.flatten() {
            entry_count += 1;
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let lower_name = name.to_lowercase();

            if lower_name == "mserve.json" {
                has_mserve_json = true;
                continue;
            }

            if lower_name == "server.properties" {
                has_server_properties = true;
                continue;
            }

            if lower_name == "eula.txt" {
                has_eula_txt = true;
                continue;
            }

            if first_jar_file.is_none() && path.is_file() && lower_name.ends_with(".jar") {
                first_jar_file = Some(name.to_string());
            }
        }
    }

    let is_empty = entry_count == 0;

    if has_mserve_json {
        return Ok(ServerDirectoryInspectionResult {
            kind: "import_mserve".to_string(),
            exists: true,
            is_directory: true,
            is_empty,
            has_mserve_json,
            has_server_properties,
            has_eula_txt,
            first_jar_file,
            message:
                "This folder already has mserve.json. Import Server will use and repair it if needed."
                    .to_string(),
        });
    }

    if has_server_properties && has_eula_txt && first_jar_file.is_some() {
        return Ok(ServerDirectoryInspectionResult {
            kind: "import_existing_server".to_string(),
            exists: true,
            is_directory: true,
            is_empty,
            has_mserve_json,
            has_server_properties,
            has_eula_txt,
            first_jar_file,
            message:
                "Existing server files detected."
                    .to_string(),
        });
    }

    if is_empty {
        return Ok(ServerDirectoryInspectionResult {
            kind: "empty_directory".to_string(),
            exists: true,
            is_directory: true,
            is_empty,
            has_mserve_json,
            has_server_properties,
            has_eula_txt,
            first_jar_file,
            message: "Directory is empty and ready for setup.".to_string(),
        });
    }

    Ok(ServerDirectoryInspectionResult {
        kind: "unsupported_existing".to_string(),
        exists: true,
        is_directory: true,
        is_empty,
        has_mserve_json,
        has_server_properties,
        has_eula_txt,
        first_jar_file,
        message:
            "This directory already contains files. Use an empty/new folder or an existing server."
                .to_string(),
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

        let config = SyncedMserveConfig {
            id: server_id.clone(),
            file: found_jar.clone(),
            ram: 4,
            storage_limit: 200,
            auto_backup: default_auto_backup(),
            auto_backup_interval: 120,
            auto_restart: false,
            custom_flags: default_custom_flags(),
            java_installation: None,
            provider: infer_provider_from_jar_file(&found_jar),
            version: infer_version_from_jar_file(&found_jar),
            provider_checks: default_provider_checks(),
            telemetry_host: default_telemetry_host(),
            telemetry_port: detect_default_telemetry_port(&directory_path),
            created_at: chrono::Local::now().to_rfc3339(),
        };

        write_synced_mserve_json(&directory_path, &config)?;

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

    if !has_required_mserve_json_fields(&object) {
        return Ok(SyncMserveJsonResult {
            status: "needs_setup".to_string(),
            message: "Required mserve.json fields are missing. Please rebuild mserve.json.".to_string(),
            config: Some(default_synced_config(&directory_path)),
            updated: false,
        });
    }

    let normalized = sanitize_mserve_value_config(&directory_path, &object);
    let normalized_json = synced_mserve_json_string(&normalized)?;

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

    let custom_flags = normalize_custom_flags(payload.custom_flags);

    let inferred_provider = infer_provider_from_jar_file(&resolved_file);
    let inferred_version = infer_version_from_jar_file(&resolved_file);

    let config = SyncedMserveConfig {
        id: existing_id,
        file: resolved_file,
        ram: payload.ram.max(1),
        storage_limit: payload.storage_limit.max(1),
        auto_backup,
        auto_backup_interval: payload.auto_backup_interval.max(1),
        auto_restart: payload.auto_restart,
        custom_flags,
        java_installation: payload
            .java_installation
            .as_deref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        provider: payload
            .provider
            .as_deref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or(inferred_provider),
        version: payload
            .version
            .as_deref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or(inferred_version),
        provider_checks: payload.provider_checks.unwrap_or_else(default_provider_checks),
        telemetry_host: payload
            .telemetry_host
            .as_deref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(default_telemetry_host),
        telemetry_port: payload
            .telemetry_port
            .filter(|value| *value > 0)
            .unwrap_or_else(|| detect_default_telemetry_port(&directory_path)),
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

