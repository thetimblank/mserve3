use super::super::support::{
    create_backup_snapshot, enforce_backup_retention, get_runtime_config, restore_backup_contents,
    set_backup_locked,
};
use super::super::{
    CreateBackupResult, RestoreBackupPayload, RestoreBackupResult, SetBackupLockedPayload,
};
use std::path::{Path, PathBuf};

/// Backups are pointless for proxy servers (no worlds, no meaningful state),
/// so every backup entry point rejects them with a clear message.
fn ensure_not_proxy(directory: &Path) -> Result<(), String> {
    let Ok(config) = get_runtime_config(directory) else {
        return Ok(());
    };
    let provider_name = config
        .provider
        .map(|provider| provider.name.trim().to_lowercase())
        .unwrap_or_default();

    if provider_name == "velocity" || provider_name == "bungeecord" {
        return Err(
            "Proxy servers don't store worlds or player data, so backups are disabled.".to_string(),
        );
    }

    Ok(())
}

/// Validates that `backup_directory` really is a backup of `server_directory`
/// (i.e. lives under its `.backups` root) and returns the canonical path.
fn resolve_backup_inside_root(
    server_directory: &Path,
    backup_directory: &str,
) -> Result<PathBuf, String> {
    let backup_root = server_directory.join(".backups");
    let backup_path = PathBuf::from(backup_directory.trim());
    if !backup_path.exists() || !backup_path.is_dir() {
        return Err("Backup directory does not exist.".to_string());
    }

    let backup_root_canonical = dunce::canonicalize(&backup_root).map_err(|err| err.to_string())?;
    let selected_canonical = dunce::canonicalize(&backup_path).map_err(|err| err.to_string())?;
    if !selected_canonical.starts_with(&backup_root_canonical) {
        return Err("Backup path is outside the server backup directory.".to_string());
    }

    Ok(selected_canonical)
}

#[tauri::command]
pub(in crate::app) fn create_server_backup(
    directory: String,
    name: Option<String>,
    reason: Option<String>,
) -> Result<CreateBackupResult, String> {
    let server_directory = PathBuf::from(directory.trim());
    if !server_directory.exists() || !server_directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }
    ensure_not_proxy(&server_directory)?;

    let reason = reason.unwrap_or_else(|| "manual".to_string());
    let deleted_backups_count = enforce_backup_retention(&server_directory, &[], true)?;
    let backup = create_backup_snapshot(&server_directory, name, &reason)?;

    Ok(CreateBackupResult {
        backup,
        deleted_backups_count,
    })
}

/// Re-applies the server's retention settings to its existing backups without
/// creating a new one. Used right after retention settings change so the user
/// sees the effect immediately. Returns the number of deleted backups.
#[tauri::command]
pub(in crate::app) fn apply_server_backup_retention(directory: String) -> Result<usize, String> {
    let server_directory = PathBuf::from(directory.trim());
    if !server_directory.exists() || !server_directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    enforce_backup_retention(&server_directory, &[], false)
}

#[tauri::command]
pub(in crate::app) fn restore_server_backup(
    payload: RestoreBackupPayload,
) -> Result<RestoreBackupResult, String> {
    let server_directory = PathBuf::from(payload.directory.trim());
    if !server_directory.exists() || !server_directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }
    ensure_not_proxy(&server_directory)?;

    let selected_backup = resolve_backup_inside_root(&server_directory, &payload.backup_directory)?;

    // Safety net: snapshot the current state before overwriting it, keeping
    // the backup being restored protected from retention.
    let deleted_backups_count = enforce_backup_retention(
        &server_directory,
        std::slice::from_ref(&selected_backup),
        true,
    )?;
    create_backup_snapshot(&server_directory, None, "pre_restore")?;

    restore_backup_contents(&server_directory, &selected_backup)?;

    Ok(RestoreBackupResult {
        deleted_backups_count,
    })
}

#[tauri::command]
pub(in crate::app) fn delete_server_backup(payload: RestoreBackupPayload) -> Result<(), String> {
    let server_directory = PathBuf::from(payload.directory.trim());
    if !server_directory.exists() || !server_directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let selected_backup = resolve_backup_inside_root(&server_directory, &payload.backup_directory)?;
    trash::delete(&selected_backup).map_err(|err| err.to_string())?;
    Ok(())
}

/// Locks or unlocks a backup. Locked backups are never removed by retention
/// policies or the storage limit.
#[tauri::command]
pub(in crate::app) fn set_server_backup_locked(
    payload: SetBackupLockedPayload,
) -> Result<(), String> {
    let server_directory = PathBuf::from(payload.directory.trim());
    if !server_directory.exists() || !server_directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let selected_backup = resolve_backup_inside_root(&server_directory, &payload.backup_directory)?;
    set_backup_locked(&selected_backup, payload.locked)
}
