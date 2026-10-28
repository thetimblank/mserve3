use super::super::support::{
    DEFAULT_SLEEP_IDLE_MINUTES, DEFAULT_SLEEP_MOTD, copy_jar_to_server_directory,
    default_backup_policy, default_backup_scope, default_provider_for_file, default_synced_config,
    default_telemetry_host, detect_default_telemetry_port, find_first_jar_file_name,
    generate_server_id, has_required_mserve_json_fields, normalize_auto_backup_modes,
    normalize_custom_flags, normalize_provider, parse_mserve_top_level_object, resolve_repair_file,
    sanitize_mserve_value_config, synced_mserve_json_string, validate_mserve_json_keys, write_eula,
    write_synced_mserve_json,
};
use super::super::{
    InitServerPayload, InitServerResult, RepairMserveJsonPayload, SyncMserveJsonResult,
    SyncedMserveConfig,
};
use std::fs;
use std::path::{Path, PathBuf};

/// Clamps an optional idle-minutes value from a payload to at least 1, defaulting
/// when absent. Keeps sleep-mode plumbing consistent across create and repair.
fn resolve_sleep_idle_minutes(minutes: Option<u32>) -> u32 {
    minutes.unwrap_or(DEFAULT_SLEEP_IDLE_MINUTES).max(1)
}

/// Resolves an optional MOTD from a payload, falling back to the default when blank.
/// Whitespace is preserved verbatim: leading spaces are how the MOTD editor centers
/// and right-aligns a line.
fn resolve_sleep_motd(motd: Option<&str>) -> String {
    motd.filter(|value| !value.trim().is_empty())
        .map_or_else(|| DEFAULT_SLEEP_MOTD.to_string(), str::to_string)
}

/// The existing mserve.json, normalized, when it parses as a JSON object. Unknown
/// keys and missing fields are tolerated (they fall back to defaults).
fn read_existing_config(directory: &Path) -> Option<SyncedMserveConfig> {
    let raw = fs::read_to_string(directory.join("mserve.json")).ok()?;
    let object = parse_mserve_top_level_object(&raw).ok()?;
    Some(sanitize_mserve_value_config(directory, &object))
}

#[tauri::command]
pub(in crate::app) fn initialize_server(
    payload: InitServerPayload,
) -> Result<InitServerResult, String> {
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

    let conflicting = if payload.adopt_existing_directory {
        // Adopted directories were just populated by a modpack install; only an
        // existing mserve.json means another managed server lives here.
        directory.join("mserve.json").exists()
    } else {
        directory.join("mserve.json").exists() || directory.join("server.properties").exists()
    };
    if conflicting {
        return Ok(InitServerResult {
            ok: false,
            message: "There is already a server in this location.".to_string(),
            id: String::new(),
            file: payload.file,
            directory: directory_str.to_string(),
        });
    }

    let auto_backup = normalize_auto_backup_modes(payload.auto_backup);

    // Copy the jar file to the server directory. Adopted directories already
    // hold their launch file (or use an argfile launch), so the name is taken
    // as-is.
    let (resolved_file, copy_message) = if payload.adopt_existing_directory {
        (
            payload.file.trim().to_string(),
            "Adopted existing server files.".to_string(),
        )
    } else {
        copy_jar_to_server_directory(&directory, payload.file.trim())?
    };
    let server_id = generate_server_id();
    let provider = payload.provider.as_ref().map_or_else(
        || default_provider_for_file(&resolved_file),
        |value| normalize_provider(value, &resolved_file),
    );

    let config = SyncedMserveConfig {
        id: server_id.clone(),
        file: resolved_file.clone(),
        ram: payload.ram.max(0.25),
        storage_limit: payload.storage_limit.max(1),
        auto_backup,
        auto_backup_interval: payload.auto_backup_interval.max(1),
        backup_policy: default_backup_policy(),
        backup_max_count: 0,
        backup_max_age_days: 0,
        backup_scope: default_backup_scope(),
        auto_restart: payload.auto_restart,
        sleep_enabled: payload.sleep_enabled,
        sleep_idle_minutes: resolve_sleep_idle_minutes(payload.sleep_idle_minutes),
        sleep_motd: resolve_sleep_motd(payload.sleep_motd.as_deref()),
        custom_flags: normalize_custom_flags(payload.custom_flags.unwrap_or_default()),
        java_installation: payload
            .java_installation
            .as_deref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        provider,
        telemetry_host: default_telemetry_host(),
        telemetry_port: detect_default_telemetry_port(&directory),
        created_at: chrono::Local::now().to_rfc3339(),
        tunnel_enabled: false,
        tunnel_id: None,
        tunnel_address: None,
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

    let (server_id, jar_file, message) = if let Some(existing) =
        read_existing_config(&directory_path)
    {
        (
            existing.id,
            existing.file,
            "Server already has mserve.json configuration. It will be validated and synced on import.".to_string(),
        )
    } else if directory_path.join("mserve.json").exists() {
        // Present but unreadable: the sync step that follows import sends it
        // through the repair dialog.
        (
            generate_server_id(),
            find_first_jar_file_name(&directory_path).unwrap_or_default(),
            "Server already has mserve.json configuration. It will be validated and synced on import.".to_string(),
        )
    } else {
        let Some(found_jar) = find_first_jar_file_name(&directory_path) else {
            return Ok(InitServerResult {
                ok: false,
                message:
                    "No jar file found in server directory. Please add a server.jar file first."
                        .to_string(),
                id: String::new(),
                file: String::new(),
                directory: directory_str.to_string(),
            });
        };

        // The defaults already target the first jar in the directory.
        let config = default_synced_config(&directory_path);
        write_synced_mserve_json(&directory_path, &config)?;

        (
            config.id,
            found_jar.clone(),
            format!("Created mserve.json with default settings. Found jar file: {found_jar}"),
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
pub(in crate::app) fn sync_server_mserve_json(
    directory: String,
) -> Result<SyncMserveJsonResult, String> {
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
    let Ok(object) = parse_mserve_top_level_object(&raw) else {
        return Ok(SyncMserveJsonResult {
            status: "needs_setup".to_string(),
            message: "The data found was invalid. Please rebuild mserve.json.".to_string(),
            config: Some(default_synced_config(&directory_path)),
            updated: false,
        });
    };

    // The file parsed, so the rebuild should start from what it holds rather
    // than from defaults (one stray key must not reset every setting).
    let invalid_message = if validate_mserve_json_keys(&object).is_err() {
        Some("The data found was invalid. Please rebuild mserve.json.")
    } else if !has_required_mserve_json_fields(&object) {
        Some("Required mserve.json fields are missing. Please rebuild mserve.json.")
    } else {
        None
    };
    if let Some(message) = invalid_message {
        return Ok(SyncMserveJsonResult {
            status: "needs_setup".to_string(),
            message: message.to_string(),
            config: Some(sanitize_mserve_value_config(&directory_path, &object)),
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
pub(in crate::app) fn repair_server_mserve_json(
    payload: RepairMserveJsonPayload,
) -> Result<SyncMserveJsonResult, String> {
    let directory_str = payload.directory.trim();
    if directory_str.is_empty() {
        return Err("Server directory is required.".to_string());
    }

    let directory_path = PathBuf::from(directory_str);
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let resolved_file = resolve_repair_file(&directory_path, &payload.file)?;
    let auto_backup = normalize_auto_backup_modes(payload.auto_backup);

    // Fields the repair form doesn't cover (identity, retention, tunnel, and
    // sleep when the caller omits it) carry over from the old file if it parses.
    let existing = read_existing_config(&directory_path);

    let custom_flags = normalize_custom_flags(payload.custom_flags);
    let provider = payload.provider.as_ref().map_or_else(
        || default_provider_for_file(&resolved_file),
        |value| normalize_provider(value, &resolved_file),
    );

    let config = SyncedMserveConfig {
        id: existing
            .as_ref()
            .map_or_else(generate_server_id, |config| config.id.clone()),
        file: resolved_file,
        ram: payload.ram.max(0.25),
        storage_limit: payload.storage_limit.max(1),
        auto_backup,
        auto_backup_interval: payload.auto_backup_interval.max(1),
        backup_policy: existing
            .as_ref()
            .map_or_else(default_backup_policy, |config| config.backup_policy.clone()),
        backup_max_count: existing
            .as_ref()
            .map_or(0, |config| config.backup_max_count),
        backup_max_age_days: existing
            .as_ref()
            .map_or(0, |config| config.backup_max_age_days),
        backup_scope: existing
            .as_ref()
            .map_or_else(default_backup_scope, |config| config.backup_scope.clone()),
        auto_restart: payload.auto_restart,
        sleep_enabled: payload
            .sleep_enabled
            .or_else(|| existing.as_ref().map(|config| config.sleep_enabled))
            .unwrap_or(false),
        sleep_idle_minutes: resolve_sleep_idle_minutes(
            payload
                .sleep_idle_minutes
                .or_else(|| existing.as_ref().map(|config| config.sleep_idle_minutes)),
        ),
        sleep_motd: resolve_sleep_motd(
            payload
                .sleep_motd
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| existing.as_ref().map(|config| config.sleep_motd.as_str())),
        ),
        custom_flags,
        java_installation: payload
            .java_installation
            .as_deref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        provider,
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
        created_at: existing.as_ref().map_or_else(
            || chrono::Local::now().to_rfc3339(),
            |config| config.created_at.clone(),
        ),
        tunnel_enabled: existing
            .as_ref()
            .is_some_and(|config| config.tunnel_enabled),
        tunnel_id: existing
            .as_ref()
            .and_then(|config| config.tunnel_id.clone()),
        tunnel_address: existing
            .as_ref()
            .and_then(|config| config.tunnel_address.clone()),
    };

    write_synced_mserve_json(&directory_path, &config)?;

    Ok(SyncMserveJsonResult {
        status: "synced".to_string(),
        message: "mserve.json was rebuilt successfully.".to_string(),
        config: Some(config),
        updated: true,
    })
}
