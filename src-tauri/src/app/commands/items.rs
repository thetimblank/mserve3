use super::super::support::{
    add_path_to_zip, copy_dir_filtered, extract_zip_to_directory, forget_content_meta, home_dir,
    is_simple_relative_name, item_roots, list_backups, list_datapacks, list_mods, list_plugins,
    list_worlds, path_size_bytes, remove_item_to_trash, resolve_item_locations,
    toggle_item_activation,
};
use super::super::{
    ExportWorldResult, ItemActionPayload, ServerScanResult, ServerStorageInfo, ToggleItemPayload,
    UploadItemPayload,
};
use super::run_blocking;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::CompressionMethod;
use zip::write::SimpleFileOptions;

#[tauri::command]
pub(in crate::app) async fn delete_server_item(payload: ItemActionPayload) -> Result<(), String> {
    run_blocking(move || remove_item_to_trash(&payload)).await
}

#[tauri::command]
pub(in crate::app) async fn uninstall_server_item(
    payload: ItemActionPayload,
) -> Result<(), String> {
    if payload.item_type != "plugin" && payload.item_type != "mod" {
        return Err("Uninstall is only supported for plugins and mods.".to_string());
    }

    run_blocking(move || remove_item_to_trash(&payload)).await
}

#[tauri::command]
pub(in crate::app) async fn export_server_world(
    payload: ItemActionPayload,
) -> Result<ExportWorldResult, String> {
    run_blocking(move || export_server_world_blocking(&payload)).await
}

fn export_server_world_blocking(payload: &ItemActionPayload) -> Result<ExportWorldResult, String> {
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
    let zip_path = downloads.join(format!("{file}-{timestamp}.zip"));
    if let Err(err) = write_world_zip(&world_path, &zip_path) {
        let _ = fs::remove_file(&zip_path);
        return Err(err);
    }

    Ok(ExportWorldResult {
        path: zip_path.to_string_lossy().to_string(),
    })
}

/// Zips `world_path` into `zip_path`. `session.lock` is skipped: it only marks
/// the world as open, and a running server holds an OS lock on it.
fn write_world_zip(world_path: &Path, zip_path: &Path) -> Result<(), String> {
    let zip_file = fs::File::create(zip_path).map_err(|err| err.to_string())?;
    let mut zip = zip::ZipWriter::new(zip_file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    for entry in WalkDir::new(world_path) {
        let entry = entry.map_err(|err| err.to_string())?;
        if entry.file_name() == "session.lock" {
            continue;
        }
        add_path_to_zip(&mut zip, world_path, entry.path(), options)?;
    }

    zip.finish().map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub(in crate::app) async fn upload_server_item(payload: UploadItemPayload) -> Result<(), String> {
    run_blocking(move || upload_server_item_blocking(&payload)).await
}

fn upload_server_item_blocking(payload: &UploadItemPayload) -> Result<(), String> {
    let server_directory = PathBuf::from(payload.directory.trim());
    if !server_directory.exists() || !server_directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let source_path = PathBuf::from(payload.source_path.trim());
    if !source_path.exists() {
        return Err("Source item does not exist.".to_string());
    }

    let item_type = payload.item_type.as_str();
    let (target_root, _) = item_roots(&server_directory, item_type)?;
    fs::create_dir_all(&target_root).map_err(|err| err.to_string())?;

    let source_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid source file name.".to_string())?;

    let is_world_zip =
        item_type == "world" && !source_path.is_dir() && has_zip_extension(source_name);
    let target_name = if is_world_zip {
        &source_name[..source_name.len() - ".zip".len()]
    } else {
        source_name
    };
    if !is_simple_relative_name(target_name) {
        return Err("Invalid item name.".to_string());
    }

    // Build the new item next to its destination first, so a failed copy or
    // extraction never costs the existing item.
    let staging = target_root.join(format!(".{target_name}.mserve-upload"));
    remove_path(&staging);
    let staged = if source_path.is_dir() {
        copy_dir_filtered(&source_path, &staging)
    } else if is_world_zip {
        extract_zip_to_directory(&source_path, &staging)
    } else {
        fs::copy(&source_path, &staging)
            .map(|_| ())
            .map_err(|err| err.to_string())
    };
    if let Err(err) = staged {
        remove_path(&staging);
        return Err(err);
    }

    let destination = target_root.join(target_name);
    if destination.exists()
        && let Err(err) = trash::delete(&destination)
    {
        remove_path(&staging);
        return Err(format!(
            "Could not replace the existing \"{target_name}\": {err}"
        ));
    }
    if let Err(err) = fs::rename(&staging, &destination) {
        remove_path(&staging);
        return Err(err.to_string());
    }

    // Any catalog provenance recorded for the old file no longer applies.
    forget_content_meta(&server_directory, item_type, target_name);
    Ok(())
}

fn has_zip_extension(name: &str) -> bool {
    Path::new(name)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
}

/// Best-effort removal of a staged file or directory.
fn remove_path(path: &Path) {
    if path.is_dir() {
        let _ = fs::remove_dir_all(path);
    } else {
        let _ = fs::remove_file(path);
    }
}

#[tauri::command]
pub(in crate::app) async fn scan_server_contents(
    directory: String,
) -> Result<ServerScanResult, String> {
    run_blocking(move || {
        let directory_path = PathBuf::from(directory.trim());
        if !directory_path.exists() || !directory_path.is_dir() {
            return Err("Server directory does not exist.".to_string());
        }

        let explicit = false;
        let worlds = list_worlds(&directory_path);
        let backups = list_backups(&directory_path);
        let worlds_size_bytes = worlds
            .iter()
            .filter(|world| world.activated)
            .fold(0_u64, |total, world| {
                total.saturating_add(world.size.unwrap_or(0))
            });
        let backups_size_bytes = backups
            .iter()
            .fold(0_u64, |total, backup| total.saturating_add(backup.size));

        Ok(ServerScanResult {
            plugins: list_plugins(&directory_path, explicit),
            mods: list_mods(&directory_path, explicit),
            worlds,
            datapacks: list_datapacks(&directory_path, explicit),
            backups,
            worlds_size_bytes,
            backups_size_bytes,
        })
    })
    .await
}

#[tauri::command]
pub(in crate::app) fn set_server_item_active(payload: ToggleItemPayload) -> Result<(), String> {
    toggle_item_activation(payload)
}

/// Batched disk-usage rollup for the dashboard: total directory size plus the
/// worlds and backups split, for every server directory in one call. Missing
/// directories report zeros rather than failing the whole batch.
#[tauri::command]
pub(in crate::app) async fn get_servers_storage(
    directories: Vec<String>,
) -> Result<Vec<ServerStorageInfo>, String> {
    run_blocking(move || Ok(directories.into_iter().map(server_storage).collect())).await
}

fn server_storage(directory: String) -> ServerStorageInfo {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.is_dir() {
        return ServerStorageInfo {
            directory,
            total_bytes: 0,
            worlds_bytes: 0,
            backups_bytes: 0,
        };
    }

    let total_bytes = path_size_bytes(&directory_path);
    let worlds_bytes = list_worlds(&directory_path)
        .iter()
        .filter(|world| world.activated)
        .fold(0_u64, |total, world| {
            total.saturating_add(world.size.unwrap_or(0))
        });
    let backups_bytes = list_backups(&directory_path)
        .iter()
        .fold(0_u64, |total, backup| total.saturating_add(backup.size));

    ServerStorageInfo {
        directory,
        total_bytes,
        worlds_bytes,
        backups_bytes,
    }
}
