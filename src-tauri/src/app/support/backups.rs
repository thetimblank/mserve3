use super::*;
use super::super::*;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;

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

            let created_at = fs::metadata(&path)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .map(|stamp| chrono::DateTime::<chrono::Local>::from(stamp).to_rfc3339())
                .unwrap_or_else(|| chrono::Local::now().to_rfc3339());

            backups.push(ScannedBackup {
                directory: path.to_string_lossy().to_string(),
                created_at,
            });
        }
    }

    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
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
    let worlds = list_worlds(directory)
        .into_iter()
        .filter(|world| world.activated)
        .collect::<Vec<ScannedWorld>>();

    if worlds.is_empty() {
        return Err("No worlds found to backup.".to_string());
    }

    let backup_root = directory.join(".backups");
    fs::create_dir_all(&backup_root).map_err(|err| err.to_string())?;

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H.%M.%S").to_string();
    let backup_dir = backup_root.join(timestamp.clone());
    fs::create_dir_all(&backup_dir).map_err(|err| err.to_string())?;

    for world in worlds {
        let world_file = world.file;
        let source = directory.join(&world_file);
        let destination = backup_dir.join(&world_file);
        if source.exists() && source.is_dir() {
            copy_dir_filtered(&source, &destination)?;
        }
    }

    Ok(ScannedBackup {
        directory: backup_dir.to_string_lossy().to_string(),
        created_at: chrono::Local::now().to_rfc3339(),
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

