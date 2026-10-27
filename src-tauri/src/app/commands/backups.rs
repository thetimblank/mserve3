use super::super::support::{
    RestoreClaim, claim_restore, create_backup_snapshot, discard_backup, enforce_backup_retention,
    ensure_backup_fits, get_runtime_config, restore_backup_contents, server_key, set_backup_locked,
};
use super::super::{
    CreateBackupResult, RestoreBackupPayload, RestoreBackupResult, RuntimeState, ScannedBackup,
    SetBackupLockedPayload,
};
use super::run_blocking;
use std::path::{Path, PathBuf};
use tauri::State;

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

/// Takes a snapshot, then applies retention with the new snapshot protected, so
/// old backups are only deleted once a good replacement exists. If retention
/// can't make room, the new snapshot is rolled back and the error returned.
/// `extra_protected` backups (e.g. the one being restored) are never deleted.
fn snapshot_then_retain(
    server_directory: &Path,
    name: Option<String>,
    reason: &str,
    extra_protected: &[PathBuf],
) -> Result<(ScannedBackup, usize), String> {
    ensure_backup_fits(server_directory, extra_protected)?;
    let backup = create_backup_snapshot(server_directory, name, reason)?;

    let mut protected = extra_protected.to_vec();
    protected.push(PathBuf::from(&backup.directory));
    match enforce_backup_retention(server_directory, &protected) {
        Ok(deleted) => Ok((backup, deleted)),
        Err(err) => {
            discard_backup(&backup);
            Err(err)
        }
    }
}

#[tauri::command]
pub(in crate::app) async fn create_server_backup(
    directory: String,
    name: Option<String>,
    reason: Option<String>,
) -> Result<CreateBackupResult, String> {
    run_blocking(move || {
        let server_directory = PathBuf::from(directory.trim());
        if !server_directory.exists() || !server_directory.is_dir() {
            return Err("Server directory does not exist.".to_string());
        }
        ensure_not_proxy(&server_directory)?;

        let reason = reason.unwrap_or_else(|| "manual".to_string());
        let (backup, deleted_backups_count) =
            snapshot_then_retain(&server_directory, name, &reason, &[])?;

        Ok(CreateBackupResult {
            backup,
            deleted_backups_count,
        })
    })
    .await
}

/// Re-applies the server's retention settings to its existing backups without
/// creating a new one. Used right after retention settings change so the user
/// sees the effect immediately. Returns the number of deleted backups.
#[tauri::command]
pub(in crate::app) async fn apply_server_backup_retention(
    directory: String,
) -> Result<usize, String> {
    run_blocking(move || {
        let server_directory = PathBuf::from(directory.trim());
        if !server_directory.exists() || !server_directory.is_dir() {
            return Err("Server directory does not exist.".to_string());
        }

        enforce_backup_retention(&server_directory, &[])
    })
    .await
}

/// Restoring rewrites the world folders, so the server's process must be fully
/// down: not running, starting, stopping, adopted, or sleeping (a join would
/// wake it mid-restore). The returned claim blocks every start path until the
/// restore finishes; it's taken under the runtime lock so no start can slip in
/// between the check and the claim.
fn claim_stopped_server(state: &RuntimeState, directory: &str) -> Result<RestoreClaim, String> {
    let processes = state
        .processes
        .lock()
        .map_err(|_| "Runtime lock failed.".to_string())?;
    let key = server_key(directory);
    if processes
        .get(&key)
        .is_some_and(|runtime| runtime.state.is_active())
    {
        return Err("Stop the server before restoring a backup.".to_string());
    }
    claim_restore(key)
}

#[tauri::command]
pub(in crate::app) async fn restore_server_backup(
    payload: RestoreBackupPayload,
    state: State<'_, RuntimeState>,
) -> Result<RestoreBackupResult, String> {
    let claim = claim_stopped_server(&state, &payload.directory)?;

    run_blocking(move || {
        let _claim = claim;
        let server_directory = PathBuf::from(payload.directory.trim());
        if !server_directory.exists() || !server_directory.is_dir() {
            return Err("Server directory does not exist.".to_string());
        }
        ensure_not_proxy(&server_directory)?;

        let selected_backup =
            resolve_backup_inside_root(&server_directory, &payload.backup_directory)?;

        // Safety net: snapshot the current state before overwriting it, keeping
        // the backup being restored protected from retention.
        let (_, deleted_backups_count) = snapshot_then_retain(
            &server_directory,
            None,
            "pre_restore",
            std::slice::from_ref(&selected_backup),
        )?;

        restore_backup_contents(&server_directory, &selected_backup)?;

        Ok(RestoreBackupResult {
            deleted_backups_count,
        })
    })
    .await
}

#[tauri::command]
pub(in crate::app) async fn delete_server_backup(
    payload: RestoreBackupPayload,
) -> Result<(), String> {
    run_blocking(move || {
        let server_directory = PathBuf::from(payload.directory.trim());
        if !server_directory.exists() || !server_directory.is_dir() {
            return Err("Server directory does not exist.".to_string());
        }

        let selected_backup =
            resolve_backup_inside_root(&server_directory, &payload.backup_directory)?;
        trash::delete(&selected_backup).map_err(|err| err.to_string())
    })
    .await
}

/// Locks or unlocks a backup. Locked backups are never removed by retention
/// policies or the storage limit.
#[tauri::command]
pub(in crate::app) async fn set_server_backup_locked(
    payload: SetBackupLockedPayload,
) -> Result<(), String> {
    run_blocking(move || {
        let server_directory = PathBuf::from(payload.directory.trim());
        if !server_directory.exists() || !server_directory.is_dir() {
            return Err("Server directory does not exist.".to_string());
        }

        let selected_backup =
            resolve_backup_inside_root(&server_directory, &payload.backup_directory)?;
        set_backup_locked(&selected_backup, payload.locked)
    })
    .await
}
