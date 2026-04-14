use super::super::support::*;
use super::super::*;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub(in crate::app) fn create_server_backup(directory: String) -> Result<ScannedBackup, String> {
    let server_directory = PathBuf::from(directory.trim());
    if !server_directory.exists() || !server_directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    create_backup_snapshot(&server_directory)
}


#[tauri::command]
pub(in crate::app) fn restore_server_backup(payload: RestoreBackupPayload) -> Result<(), String> {
    let server_directory = PathBuf::from(payload.directory.trim());
    if !server_directory.exists() || !server_directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let backup_root = server_directory.join(".backups");
    let backup_directory = PathBuf::from(payload.backup_directory.trim());
    if !backup_directory.exists() || !backup_directory.is_dir() {
        return Err("Backup directory does not exist.".to_string());
    }

    let backup_root_canonical = backup_root.canonicalize().map_err(|err| err.to_string())?;
    let selected_backup_canonical = backup_directory.canonicalize().map_err(|err| err.to_string())?;
    if !selected_backup_canonical.starts_with(&backup_root_canonical) {
        return Err("Backup path is outside the server backup directory.".to_string());
    }

    create_backup_snapshot(&server_directory)?;

    let backup_worlds = list_backup_worlds(&selected_backup_canonical);
    if backup_worlds.is_empty() {
        return Err("Selected backup has no worlds.".to_string());
    }

    for backup_world in backup_worlds {
        let Some(world_name) = backup_world.file_name() else {
            continue;
        };
        let destination = server_directory.join(world_name);

        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|err| err.to_string())?;
        }

        copy_dir_filtered(&backup_world, &destination)?;
    }

    Ok(())
}

#[tauri::command]
pub(in crate::app) fn delete_server_backup(payload: RestoreBackupPayload) -> Result<(), String> {
    let server_directory = PathBuf::from(payload.directory.trim());
    if !server_directory.exists() || !server_directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let backup_root = server_directory.join(".backups");
    if !backup_root.exists() || !backup_root.is_dir() {
        return Err("Backup directory does not exist.".to_string());
    }

    let backup_directory = PathBuf::from(payload.backup_directory.trim());
    if !backup_directory.exists() || !backup_directory.is_dir() {
        return Err("Backup directory does not exist.".to_string());
    }

    let backup_root_canonical = backup_root.canonicalize().map_err(|err| err.to_string())?;
    let selected_backup_canonical = backup_directory.canonicalize().map_err(|err| err.to_string())?;
    if !selected_backup_canonical.starts_with(&backup_root_canonical) {
        return Err("Backup path is outside the server backup directory.".to_string());
    }

    trash::delete(&selected_backup_canonical).map_err(|err| err.to_string())?;
    Ok(())
}

