use super::super::support::*;
use super::super::*;
use std::fs;
use std::path::PathBuf;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

#[tauri::command]
pub(in crate::app) fn delete_server_item(payload: ItemActionPayload) -> Result<(), String> {
    remove_item_to_trash(&payload)
}

#[tauri::command]
pub(in crate::app) fn uninstall_server_item(payload: ItemActionPayload) -> Result<(), String> {
    if payload.item_type != "plugin" {
        return Err("Uninstall is only supported for plugins.".to_string());
    }

    remove_item_to_trash(&payload)
}

#[tauri::command]
pub(in crate::app) fn export_server_world(payload: ItemActionPayload) -> Result<ExportWorldResult, String> {
    if payload.item_type != "world" {
        return Err("Export is only supported for worlds.".to_string());
    }

    let directory = PathBuf::from(payload.directory.trim());
    if !directory.exists() || !directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let file = payload.file.trim();
    if !is_simple_relative_name(file) {
        return Err("Invalid world path.".to_string());
    }

    let (active_path, inactive_path) = resolve_item_locations(&directory, "world", file)?;
    let world_path = if active_path.exists() {
        active_path
    } else if inactive_path.exists() {
        inactive_path
    } else {
        return Err("World folder not found.".to_string());
    };

    if !world_path.is_dir() {
        return Err("World export expects a directory.".to_string());
    }

    let downloads = home_dir().join("Downloads");
    fs::create_dir_all(&downloads).map_err(|err| err.to_string())?;

    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let zip_path = downloads.join(format!("{}-{}.zip", file, timestamp));
    let zip_file = fs::File::create(&zip_path).map_err(|err| err.to_string())?;
    let mut zip = zip::ZipWriter::new(zip_file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    for entry in WalkDir::new(&world_path).into_iter().flatten() {
        add_path_to_zip(&mut zip, &world_path, entry.path(), options)?;
    }

    zip.finish().map_err(|err| err.to_string())?;

    Ok(ExportWorldResult {
        path: zip_path.to_string_lossy().to_string(),
    })
}


#[tauri::command]
pub(in crate::app) fn upload_server_item(payload: UploadItemPayload) -> Result<(), String> {
    let server_directory = PathBuf::from(payload.directory.trim());
    if !server_directory.exists() || !server_directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let source_path = PathBuf::from(payload.source_path.trim());
    if !source_path.exists() {
        return Err("Source item does not exist.".to_string());
    }

    let (target_root, _) = item_roots(&server_directory, payload.item_type.as_str())?;
    fs::create_dir_all(&target_root).map_err(|err| err.to_string())?;

    let source_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid source file name.".to_string())?;

    if source_path.is_dir() {
        let destination = target_root.join(source_name);
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|err| err.to_string())?;
        }
        copy_dir_filtered(&source_path, &destination)?;
        return Ok(());
    }

    if payload.item_type == "world" && source_name.to_lowercase().ends_with(".zip") {
        let world_name = source_name.trim_end_matches(".zip");
        let destination = target_root.join(world_name);
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|err| err.to_string())?;
        }
        extract_zip_to_directory(&source_path, &destination)?;
        return Ok(());
    }

    let destination = target_root.join(source_name);
    fs::copy(&source_path, &destination).map_err(|err| err.to_string())?;
    Ok(())
}


#[tauri::command]
pub(in crate::app) fn scan_server_contents(directory: String) -> Result<ServerScanResult, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let explicit = false;

    Ok(ServerScanResult {
        plugins: list_plugins(&directory_path, explicit),
        worlds: list_worlds(&directory_path),
        datapacks: list_datapacks(&directory_path, explicit),
        backups: list_backups(&directory_path),
    })
}

#[tauri::command]
pub(in crate::app) fn set_server_item_active(payload: ToggleItemPayload) -> Result<(), String> {
    toggle_item_activation(payload)
}

