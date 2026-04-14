use super::super::support::*;
use std::path::PathBuf;

#[tauri::command]
pub(in crate::app) fn open_server_folder(directory: String) -> Result<(), String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    open_path_in_file_manager(&directory_path)
}

#[tauri::command]
pub(in crate::app) fn open_server_path(path: String) -> Result<(), String> {
    let raw = path.trim();
    let target = PathBuf::from(raw.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !target.exists() {
        return Err("Target path does not exist.".to_string());
    }

    let open_target = if target.is_dir() {
        target
    } else {
        target
            .parent()
            .map(|parent| parent.to_path_buf())
            .ok_or_else(|| "Cannot resolve parent directory.".to_string())?
    };

    open_path_in_file_manager(&open_target)
}

