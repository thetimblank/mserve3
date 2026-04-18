use super::*;
use super::super::*;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;

const STORAGE_LIMIT_DEFAULT_GB: u64 = 200;
const STORAGE_LIMIT_MIN_GB: u64 = 1;
const MAX_BACKUPS_DELETED_PER_CREATION: usize = 5;
const BYTES_PER_GB: u64 = 1024 * 1024 * 1024;
const STORAGE_LIMIT_ERROR_PREFIX: &str = "Backup storage limit exceeded";
const BACKUP_METADATA_FILE_NAME: &str = ".mserve-backup.json";

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct BackupSnapshotMetadata {
    created_at: String,
    size: u64,
}

fn backup_metadata_path(backup_directory: &Path) -> PathBuf {
    backup_directory.join(BACKUP_METADATA_FILE_NAME)
}

fn read_backup_metadata(backup_directory: &Path) -> Option<BackupSnapshotMetadata> {
    let metadata_path = backup_metadata_path(backup_directory);
    let raw = fs::read_to_string(metadata_path).ok()?;
    serde_json::from_str::<BackupSnapshotMetadata>(&raw).ok()
}

fn write_backup_metadata(
    backup_directory: &Path,
    created_at: &str,
    size: u64,
) -> Result<(), String> {
    let metadata = BackupSnapshotMetadata {
        created_at: created_at.to_string(),
        size,
    };

    let raw = serde_json::to_vec_pretty(&metadata).map_err(|err| err.to_string())?;
    fs::write(backup_metadata_path(backup_directory), raw).map_err(|err| err.to_string())
}

fn parse_created_at_millis(created_at: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(created_at)
        .map(|value| value.timestamp_millis())
        .unwrap_or(0)
}

fn backup_world_paths(directory: &Path) -> Vec<PathBuf> {
    list_worlds(directory)
        .into_iter()
        .filter(|world| world.activated)
        .map(|world| directory.join(world.file))
        .filter(|path| path.exists() && path.is_dir())
        .collect::<Vec<PathBuf>>()
}

fn canonicalized_path(path: &Path) -> Option<PathBuf> {
    path.canonicalize().ok()
}

fn list_backups_oldest_first(directory: &Path) -> Vec<PathBuf> {
    let backup_root = directory.join(".backups");
    if !backup_root.exists() || !backup_root.is_dir() {
        return vec![];
    }

    let mut backups = vec![];
    if let Ok(entries) = fs::read_dir(&backup_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let modified = fs::metadata(&path)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            backups.push((modified, path));
        }
    }

    backups.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    backups.into_iter().map(|(_, path)| path).collect()
}

fn resolve_storage_limit_bytes(directory: &Path) -> Result<u64, String> {
    let config = get_runtime_config(directory)?;
    let limit_gb = config.storage_limit.unwrap_or(STORAGE_LIMIT_DEFAULT_GB as u32) as u64;
    Ok(limit_gb
        .max(STORAGE_LIMIT_MIN_GB)
        .saturating_mul(BYTES_PER_GB))
}

fn delete_cap_exceeded_error() -> String {
    format!(
        "{STORAGE_LIMIT_ERROR_PREFIX}: deleting more than {MAX_BACKUPS_DELETED_PER_CREATION} backups is required to create a new backup."
    )
}

pub(in crate::app) fn calculate_active_worlds_size_bytes(directory: &Path) -> u64 {
    backup_world_paths(directory)
        .into_iter()
        .fold(0_u64, |total, world| total.saturating_add(path_size_bytes(&world)))
}

pub(in crate::app) fn calculate_total_backups_size_bytes(directory: &Path) -> u64 {
    let backup_root = directory.join(".backups");
    if !backup_root.exists() || !backup_root.is_dir() {
        return 0;
    }

    let mut total = 0_u64;
    if let Ok(entries) = fs::read_dir(&backup_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            total = total.saturating_add(path_size_bytes(&path));
        }
    }

    total
}

pub(in crate::app) fn enforce_backup_storage_limit(
    directory: &Path,
    protected_backups: &[PathBuf],
) -> Result<usize, String> {
    let new_backup_size = calculate_active_worlds_size_bytes(directory);
    if new_backup_size == 0 {
        return Err("No worlds found to backup.".to_string());
    }

    let storage_limit_bytes = resolve_storage_limit_bytes(directory)?;
    if new_backup_size > storage_limit_bytes {
        return Err(format!(
            "{STORAGE_LIMIT_ERROR_PREFIX}: active worlds size exceeds the configured storage limit."
        ));
    }

    let protected_canonical = protected_backups
        .iter()
        .filter_map(|path| canonicalized_path(path))
        .collect::<Vec<PathBuf>>();

    let mut backups_size = calculate_total_backups_size_bytes(directory);
    if backups_size.saturating_add(new_backup_size) <= storage_limit_bytes {
        return Ok(0);
    }

    let oldest_backups = list_backups_oldest_first(directory);
    let mut deleted_count = 0_usize;

    for backup_path in oldest_backups {
        let should_keep = canonicalized_path(&backup_path)
            .as_ref()
            .map(|candidate| protected_canonical.iter().any(|protected| protected == candidate))
            .unwrap_or(false);
        if should_keep {
            continue;
        }

        if deleted_count >= MAX_BACKUPS_DELETED_PER_CREATION {
            return Err(delete_cap_exceeded_error());
        }

        let removed_size = path_size_bytes(&backup_path);
        fs::remove_dir_all(&backup_path).map_err(|err| err.to_string())?;
        backups_size = backups_size.saturating_sub(removed_size);
        deleted_count += 1;

        if backups_size.saturating_add(new_backup_size) <= storage_limit_bytes {
            return Ok(deleted_count);
        }
    }

    if deleted_count >= MAX_BACKUPS_DELETED_PER_CREATION {
        return Err(delete_cap_exceeded_error());
    }

    Err(format!(
        "{STORAGE_LIMIT_ERROR_PREFIX}: no removable backups remain to satisfy the configured storage limit."
    ))
}

pub(in crate::app) fn list_backup_worlds(backup_directory: &Path) -> Vec<PathBuf> {
    let mut worlds = vec![];
    if let Ok(entries) = fs::read_dir(backup_directory) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("level.dat").exists() {
                worlds.push(path);
            }
        }
    }
    worlds
}

pub(in crate::app) fn list_backups(directory: &Path) -> Vec<ScannedBackup> {
    let backup_root = directory.join(".backups");
    if !backup_root.exists() || !backup_root.is_dir() {
        return vec![];
    }

    let mut backups = vec![];
    if let Ok(entries) = fs::read_dir(&backup_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let Some(_) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };

            let metadata = read_backup_metadata(&path);
            let created_at = metadata
                .as_ref()
                .map(|value| value.created_at.clone())
                .or_else(|| {
                    fs::metadata(&path)
                        .ok()
                        .and_then(|metadata| metadata.modified().ok())
                        .map(|stamp| chrono::DateTime::<chrono::Local>::from(stamp).to_rfc3339())
                })
                .unwrap_or_else(|| chrono::Local::now().to_rfc3339());

            let size = metadata
                .as_ref()
                .map(|value| value.size)
                .unwrap_or_else(|| path_size_bytes(&path));

            backups.push(ScannedBackup {
                directory: path.to_string_lossy().to_string(),
                created_at,
                size,
            });
        }
    }

    backups.sort_by(|a, b| {
        parse_created_at_millis(&b.created_at)
            .cmp(&parse_created_at_millis(&a.created_at))
            .then_with(|| b.directory.cmp(&a.directory))
    });
    backups
}

pub(in crate::app) fn copy_dir_filtered(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|err| err.to_string())?;

    for entry in WalkDir::new(source).into_iter().flatten() {
        let entry_path = entry.path();
        let relative = entry_path.strip_prefix(source).map_err(|err| err.to_string())?;
        if relative.as_os_str().is_empty() {
            continue;
        }

        if relative.to_string_lossy().contains("session.lock") {
            continue;
        }

        let dest_path = destination.join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&dest_path).map_err(|err| err.to_string())?;
        } else {
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            fs::copy(entry_path, &dest_path).map_err(|err| err.to_string())?;
        }
    }

    Ok(())
}

pub(in crate::app) fn create_backup_snapshot(directory: &Path) -> Result<ScannedBackup, String> {
    let worlds = backup_world_paths(directory);

    if worlds.is_empty() {
        return Err("No worlds found to backup.".to_string());
    }

    let backup_root = directory.join(".backups");
    fs::create_dir_all(&backup_root).map_err(|err| err.to_string())?;

    let now = chrono::Local::now();
    let timestamp = now.format("%Y-%m-%d_%H.%M.%S").to_string();
    let created_at = now.to_rfc3339();
    let backup_dir = backup_root.join(timestamp.clone());
    fs::create_dir_all(&backup_dir).map_err(|err| err.to_string())?;

    for source in worlds {
        let Some(world_name) = source.file_name() else {
            continue;
        };
        let destination = backup_dir.join(world_name);
        copy_dir_filtered(&source, &destination)?;
    }

    let size = path_size_bytes(&backup_dir);
    write_backup_metadata(&backup_dir, &created_at, size)?;

    Ok(ScannedBackup {
        directory: backup_dir.to_string_lossy().to_string(),
        created_at,
        size,
    })
}

pub(in crate::app) fn move_directory_with_fallback(src: &Path, dest: &Path) -> Result<(), String> {
    if src == dest {
        return Ok(());
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    if fs::rename(src, dest).is_ok() {
        return Ok(());
    }

    copy_dir_filtered(src, dest)?;
    fs::remove_dir_all(src).map_err(|err| err.to_string())?;
    Ok(())
}

pub(in crate::app) fn swap_files(path_a: &Path, path_b: &Path) -> Result<(), String> {
    if path_a == path_b {
        return Ok(());
    }

    if !path_a.exists() || !path_a.is_file() {
        return Err("Current server jar file does not exist in server directory.".to_string());
    }

    if !path_b.exists() || !path_b.is_file() {
        return Err("Selected jar file does not exist.".to_string());
    }

    let temp_name = format!(
        ".mserve.swap.{}.tmp",
        chrono::Local::now().timestamp_nanos_opt().unwrap_or(0)
    );

    let temp_path = path_b
        .parent()
        .ok_or_else(|| "Invalid selected jar location.".to_string())?
        .join(temp_name);

    move_file_with_fallback(path_b, &temp_path)?;
    if let Err(err) = move_file_with_fallback(path_a, path_b) {
        let _ = move_file_with_fallback(&temp_path, path_b);
        return Err(err);
    }

    if let Err(err) = move_file_with_fallback(&temp_path, path_a) {
        return Err(format!("Swap completed partially. Manual fix may be required: {err}"));
    }

    Ok(())
}

pub(in crate::app) fn extract_zip_to_directory(zip_path: &Path, destination: &Path) -> Result<(), String> {
    let zip_file = fs::File::open(zip_path).map_err(|err| err.to_string())?;
    let mut archive = zip::ZipArchive::new(zip_file).map_err(|err| err.to_string())?;

    fs::create_dir_all(destination).map_err(|err| err.to_string())?;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|err| err.to_string())?;
        let enclosed = file
            .enclosed_name()
            .map(|path| path.to_path_buf())
            .ok_or_else(|| "Invalid zip entry path.".to_string())?;

        let out_path = destination.join(enclosed);
        if file.name().ends_with('/') {
            fs::create_dir_all(&out_path).map_err(|err| err.to_string())?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let mut outfile = fs::File::create(&out_path).map_err(|err| err.to_string())?;
        io::copy(&mut file, &mut outfile).map_err(|err| err.to_string())?;
    }

    Ok(())
}


pub(in crate::app) fn add_path_to_zip<W: Write + io::Seek>(
    writer: &mut zip::ZipWriter<W>,
    root: &Path,
    path: &Path,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|err| err.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    if relative.is_empty() {
        return Ok(());
    }

    if path.is_dir() {
        writer
            .add_directory(format!("{relative}/"), options)
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    writer
        .start_file(relative, options)
        .map_err(|err| err.to_string())?;
    let mut file = fs::File::open(path).map_err(|err| err.to_string())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).map_err(|err| err.to_string())?;
    writer.write_all(&buffer).map_err(|err| err.to_string())?;
    Ok(())
}

