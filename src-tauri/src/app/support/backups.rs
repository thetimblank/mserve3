use super::super::ScannedBackup;
use super::{
    get_runtime_config, list_worlds, move_file_with_fallback, normalize_backup_policy,
    normalize_backup_scope, path_size_bytes,
};
use chrono::Datelike;
use std::collections::HashSet;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;

const STORAGE_LIMIT_DEFAULT_GB: u64 = 200;
const STORAGE_LIMIT_MIN_GB: u64 = 1;
const BYTES_PER_GB: u64 = 1024 * 1024 * 1024;
const STORAGE_LIMIT_ERROR_PREFIX: &str = "Backup storage limit exceeded";
const BACKUP_METADATA_FILE_NAME: &str = ".mserve-backup.json";

/// Loose config files captured by the "configs" backup scope (the `config/`
/// directory — Paper's global config — is captured separately).
const CONFIG_SCOPE_FILES: [&str; 9] = [
    "server.properties",
    "bukkit.yml",
    "spigot.yml",
    "paper.yml",
    "ops.json",
    "whitelist.json",
    "banned-players.json",
    "banned-ips.json",
    "permissions.yml",
];
const CONFIG_SCOPE_DIR: &str = "config";

// Smart-retention thinning windows: keep everything recent, then thin older
// backups to one per day, then one per week, then one per month.
const SMART_KEEP_ALL_HOURS: i64 = 48;
const SMART_DAILY_DAYS: i64 = 14;
const SMART_WEEKLY_DAYS: i64 = 60;

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
struct BackupSnapshotMetadata {
    created_at: String,
    size: u64,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    locked: bool,
    #[serde(default)]
    contents: Vec<String>,
}

/// Per-server backup behavior resolved from mserve.json (with defaults for
/// configs written by older versions).
struct BackupConfig {
    policy: String,
    max_count: u32,
    max_age_days: u32,
    scope: Vec<String>,
    storage_limit_bytes: u64,
}

fn resolve_backup_config(directory: &Path) -> Result<BackupConfig, String> {
    let config = get_runtime_config(directory)?;
    let limit_gb = u64::from(
        config
            .storage_limit
            .unwrap_or(STORAGE_LIMIT_DEFAULT_GB as u32),
    );

    Ok(BackupConfig {
        policy: normalize_backup_policy(config.backup_policy.as_deref()),
        max_count: config.backup_max_count.unwrap_or(0),
        max_age_days: config.backup_max_age_days.unwrap_or(0),
        scope: normalize_backup_scope(config.backup_scope.as_deref()),
        storage_limit_bytes: limit_gb
            .max(STORAGE_LIMIT_MIN_GB)
            .saturating_mul(BYTES_PER_GB),
    })
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
    metadata: &BackupSnapshotMetadata,
) -> Result<(), String> {
    let raw = serde_json::to_vec_pretty(metadata).map_err(|err| err.to_string())?;
    fs::write(backup_metadata_path(backup_directory), raw).map_err(|err| err.to_string())
}

/// Flips the retention lock on a backup, preserving the rest of its metadata.
/// Backups from older versions without a metadata file get one created.
pub(in crate::app) fn set_backup_locked(
    backup_directory: &Path,
    locked: bool,
) -> Result<(), String> {
    let mut metadata =
        read_backup_metadata(backup_directory).unwrap_or_else(|| BackupSnapshotMetadata {
            created_at: backup_created_at(backup_directory),
            size: path_size_bytes(backup_directory),
            contents: detect_backup_contents(backup_directory),
            ..BackupSnapshotMetadata::default()
        });
    metadata.locked = locked;
    write_backup_metadata(backup_directory, &metadata)
}

fn parse_created_at_millis(created_at: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(created_at).map_or(0, |value| value.timestamp_millis())
}

/// Best-effort creation timestamp: metadata first, filesystem mtime second.
fn backup_created_at(backup_directory: &Path) -> String {
    read_backup_metadata(backup_directory)
        .map(|metadata| metadata.created_at)
        .or_else(|| {
            fs::metadata(backup_directory)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .map(|stamp| chrono::DateTime::<chrono::Local>::from(stamp).to_rfc3339())
        })
        .unwrap_or_else(|| chrono::Local::now().to_rfc3339())
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
    dunce::canonicalize(path).ok()
}

/// The source paths a backup with the given scope would copy, grouped by the
/// scope item that contributed them. Scope items with nothing on disk are
/// omitted.
fn backup_source_paths(directory: &Path, scope: &[String]) -> Vec<(String, Vec<PathBuf>)> {
    let mut groups: Vec<(String, Vec<PathBuf>)> = vec![];

    for item in scope {
        let paths = match item.as_str() {
            "worlds" => backup_world_paths(directory),
            "plugins" | "mods" => {
                let root = directory.join(item);
                if root.is_dir() { vec![root] } else { vec![] }
            }
            "configs" => {
                let mut paths = CONFIG_SCOPE_FILES
                    .iter()
                    .map(|file| directory.join(file))
                    .filter(|path| path.is_file())
                    .collect::<Vec<PathBuf>>();
                let config_dir = directory.join(CONFIG_SCOPE_DIR);
                if config_dir.is_dir() {
                    paths.push(config_dir);
                }
                paths
            }
            _ => vec![],
        };

        if !paths.is_empty() {
            groups.push((item.clone(), paths));
        }
    }

    groups
}

/// Estimated on-disk size of the next backup for this server's scope.
pub(in crate::app) fn estimate_backup_size_bytes(directory: &Path) -> u64 {
    let Ok(config) = resolve_backup_config(directory) else {
        return 0;
    };

    backup_source_paths(directory, &config.scope)
        .iter()
        .flat_map(|(_, paths)| paths.iter())
        .fold(0_u64, |total, path| {
            total.saturating_add(path_size_bytes(path))
        })
}

/// One existing backup, as seen by the retention engine.
struct BackupEntry {
    path: PathBuf,
    created_at_millis: i64,
    size: u64,
    locked: bool,
}

/// All backups on disk, oldest first. `protected` paths count as locked.
fn collect_backup_entries(directory: &Path, protected: &[PathBuf]) -> Vec<BackupEntry> {
    let backup_root = directory.join(".backups");
    if !backup_root.is_dir() {
        return vec![];
    }

    let protected_canonical = protected
        .iter()
        .filter_map(|path| canonicalized_path(path))
        .collect::<Vec<PathBuf>>();

    let mut entries = vec![];
    if let Ok(dir_entries) = fs::read_dir(&backup_root) {
        for entry in dir_entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let metadata = read_backup_metadata(&path);
            let created_at = backup_created_at(&path);
            let is_protected = canonicalized_path(&path)
                .as_ref()
                .is_some_and(|candidate| protected_canonical.iter().any(|item| item == candidate));

            entries.push(BackupEntry {
                created_at_millis: parse_created_at_millis(&created_at),
                size: metadata
                    .as_ref()
                    .map_or_else(|| path_size_bytes(&path), |value| value.size),
                locked: is_protected || metadata.as_ref().is_some_and(|value| value.locked),
                path,
            });
        }
    }

    entries.sort_by(|a, b| {
        a.created_at_millis
            .cmp(&b.created_at_millis)
            .then_with(|| a.path.cmp(&b.path))
    });
    entries
}

/// The smart policy's thinning bucket for a backup of a given age: everything
/// recent is kept, older backups collapse to one per day, week, then month.
/// Returns `None` while the backup is inside the keep-all window.
fn smart_retention_bucket(created_at_millis: i64, now_millis: i64) -> Option<String> {
    let age_millis = now_millis.saturating_sub(created_at_millis);
    if age_millis <= SMART_KEEP_ALL_HOURS * 60 * 60 * 1000 {
        return None;
    }

    let created = chrono::DateTime::from_timestamp_millis(created_at_millis)
        .map(|value| value.with_timezone(&chrono::Local))?;
    let age_days = age_millis / (24 * 60 * 60 * 1000);

    if age_days <= SMART_DAILY_DAYS {
        return Some(format!("day-{}-{:03}", created.year(), created.ordinal()));
    }
    if age_days <= SMART_WEEKLY_DAYS {
        let week = created.iso_week();
        return Some(format!("week-{}-{:02}", week.year(), week.week()));
    }
    Some(format!("month-{}-{:02}", created.year(), created.month()))
}

/// Applies the server's retention settings to its existing backups and deletes
/// what falls out. `incoming_backup` is true when a new backup is about to be
/// created, so caps leave room for it and the storage check includes its
/// estimated size. Locked and `protected` backups are never deleted. Returns
/// the number of deleted backups.
pub(in crate::app) fn enforce_backup_retention(
    directory: &Path,
    protected_backups: &[PathBuf],
    incoming_backup: bool,
) -> Result<usize, String> {
    let config = resolve_backup_config(directory)?;

    let incoming_size = if incoming_backup {
        let size = estimate_backup_size_bytes(directory);
        if size == 0 {
            return Err("Nothing to back up: the selected backup contents are empty.".to_string());
        }
        if size > config.storage_limit_bytes {
            return Err(format!(
                "{STORAGE_LIMIT_ERROR_PREFIX}: the server contents are larger than the configured storage limit."
            ));
        }
        size
    } else {
        0
    };

    let entries = collect_backup_entries(directory, protected_backups);
    let now_millis = chrono::Local::now().timestamp_millis();
    let mut doomed: HashSet<PathBuf> = HashSet::new();

    // 1. Age cap.
    if config.max_age_days > 0 {
        let cutoff = now_millis - i64::from(config.max_age_days) * 24 * 60 * 60 * 1000;
        for entry in &entries {
            if !entry.locked && entry.created_at_millis < cutoff {
                doomed.insert(entry.path.clone());
            }
        }
    }

    // 2. Smart thinning: within each bucket keep only the newest survivor
    //    (iterating newest → oldest keeps the freshest one per bucket).
    if config.policy == "smart" {
        let mut seen_buckets: HashSet<String> = HashSet::new();
        for entry in entries.iter().rev() {
            if doomed.contains(&entry.path) {
                continue;
            }
            let Some(bucket) = smart_retention_bucket(entry.created_at_millis, now_millis) else {
                continue;
            };
            if seen_buckets.contains(&bucket) {
                if !entry.locked {
                    doomed.insert(entry.path.clone());
                }
            } else {
                seen_buckets.insert(bucket);
            }
        }
    }

    // 3. Count cap (leaving a slot for the incoming backup). Locked backups
    //    occupy slots but are never deleted, so the cap is best-effort.
    if config.max_count > 0 {
        let allowed = (config.max_count as usize).saturating_sub(usize::from(incoming_backup));
        let mut kept = 0_usize;
        for entry in entries.iter().rev() {
            if doomed.contains(&entry.path) {
                continue;
            }
            if entry.locked {
                kept += 1;
                continue;
            }
            if kept >= allowed {
                doomed.insert(entry.path.clone());
            } else {
                kept += 1;
            }
        }
    }

    // 4. Storage limit: drop the oldest unlocked survivors until it fits.
    let mut surviving_size: u64 = entries
        .iter()
        .filter(|entry| !doomed.contains(&entry.path))
        .fold(0_u64, |total, entry| total.saturating_add(entry.size));

    for entry in &entries {
        if surviving_size.saturating_add(incoming_size) <= config.storage_limit_bytes {
            break;
        }
        if entry.locked || doomed.contains(&entry.path) {
            continue;
        }
        doomed.insert(entry.path.clone());
        surviving_size = surviving_size.saturating_sub(entry.size);
    }

    if surviving_size.saturating_add(incoming_size) > config.storage_limit_bytes {
        let has_locked = entries.iter().any(|entry| entry.locked);
        return Err(if has_locked {
            format!(
                "{STORAGE_LIMIT_ERROR_PREFIX}: locked backups occupy the storage budget. Unlock or delete some, or raise the limit."
            )
        } else {
            format!(
                "{STORAGE_LIMIT_ERROR_PREFIX}: no removable backups remain to satisfy the configured storage limit."
            )
        });
    }

    let mut deleted_count = 0_usize;
    for path in doomed {
        fs::remove_dir_all(&path).map_err(|err| err.to_string())?;
        deleted_count += 1;
    }

    Ok(deleted_count)
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

/// The scope items actually present inside an existing backup directory.
/// Older backups without metadata are inferred from their layout.
pub(in crate::app) fn detect_backup_contents(backup_directory: &Path) -> Vec<String> {
    if let Some(metadata) = read_backup_metadata(backup_directory)
        && !metadata.contents.is_empty()
    {
        return metadata.contents;
    }

    let mut contents = vec![];
    if !list_backup_worlds(backup_directory).is_empty() {
        contents.push("worlds".to_string());
    }
    for dir in ["plugins", "mods"] {
        if backup_directory.join(dir).is_dir() {
            contents.push(dir.to_string());
        }
    }
    let has_configs = CONFIG_SCOPE_FILES
        .iter()
        .any(|file| backup_directory.join(file).is_file())
        || backup_directory.join(CONFIG_SCOPE_DIR).is_dir();
    if has_configs {
        contents.push("configs".to_string());
    }
    contents
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
            let created_at = backup_created_at(&path);
            let size = metadata
                .as_ref()
                .map_or_else(|| path_size_bytes(&path), |value| value.size);

            backups.push(ScannedBackup {
                directory: path.to_string_lossy().to_string(),
                created_at,
                size,
                name: metadata.as_ref().and_then(|value| value.name.clone()),
                reason: metadata.as_ref().and_then(|value| value.reason.clone()),
                locked: metadata.as_ref().is_some_and(|value| value.locked),
                contents: detect_backup_contents(&path),
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

pub(in crate::app) fn create_backup_snapshot(
    directory: &Path,
    name: Option<String>,
    reason: &str,
) -> Result<ScannedBackup, String> {
    let config = resolve_backup_config(directory)?;
    let sources = backup_source_paths(directory, &config.scope);

    if sources.is_empty() {
        return Err(
            "Nothing to back up: the selected backup contents are empty for this server."
                .to_string(),
        );
    }

    let backup_root = directory.join(".backups");
    fs::create_dir_all(&backup_root).map_err(|err| err.to_string())?;

    let now = chrono::Local::now();
    let timestamp = now.format("%Y-%m-%d_%H.%M.%S").to_string();
    let created_at = now.to_rfc3339();
    let backup_dir = backup_root.join(timestamp.clone());
    fs::create_dir_all(&backup_dir).map_err(|err| err.to_string())?;

    for (_, paths) in &sources {
        for source in paths {
            let Some(entry_name) = source.file_name() else {
                continue;
            };
            let destination = backup_dir.join(entry_name);
            if source.is_dir() {
                copy_dir_filtered(source, &destination)?;
            } else {
                fs::copy(source, &destination).map_err(|err| err.to_string())?;
            }
        }
    }

    let contents = sources
        .iter()
        .map(|(scope_item, _)| scope_item.clone())
        .collect::<Vec<String>>();
    let size = path_size_bytes(&backup_dir);
    let normalized_name = name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(std::string::ToString::to_string);

    let metadata = BackupSnapshotMetadata {
        created_at: created_at.clone(),
        size,
        name: normalized_name.clone(),
        reason: Some(reason.to_string()),
        locked: false,
        contents: contents.clone(),
    };
    write_backup_metadata(&backup_dir, &metadata)?;

    Ok(ScannedBackup {
        directory: backup_dir.to_string_lossy().to_string(),
        created_at,
        size,
        name: normalized_name,
        reason: Some(reason.to_string()),
        locked: false,
        contents,
    })
}

/// Restores everything a backup contains back into the server directory:
/// worlds (dirs with a level.dat), the plugins/mods folders, and captured
/// config files. Returns the restored scope items.
pub(in crate::app) fn restore_backup_contents(
    server_directory: &Path,
    backup_directory: &Path,
) -> Result<Vec<String>, String> {
    let mut restored = vec![];

    let backup_worlds = list_backup_worlds(backup_directory);
    if !backup_worlds.is_empty() {
        for backup_world in &backup_worlds {
            let Some(world_name) = backup_world.file_name() else {
                continue;
            };
            let destination = server_directory.join(world_name);
            if destination.exists() {
                fs::remove_dir_all(&destination).map_err(|err| err.to_string())?;
            }
            copy_dir_filtered(backup_world, &destination)?;
        }
        restored.push("worlds".to_string());
    }

    for dir in ["plugins", "mods"] {
        let source = backup_directory.join(dir);
        if !source.is_dir() {
            continue;
        }
        let destination = server_directory.join(dir);
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|err| err.to_string())?;
        }
        copy_dir_filtered(&source, &destination)?;
        restored.push(dir.to_string());
    }

    let mut restored_configs = false;
    for file in CONFIG_SCOPE_FILES {
        let source = backup_directory.join(file);
        if !source.is_file() {
            continue;
        }
        fs::copy(&source, server_directory.join(file)).map_err(|err| err.to_string())?;
        restored_configs = true;
    }
    let config_dir_source = backup_directory.join(CONFIG_SCOPE_DIR);
    if config_dir_source.is_dir() {
        let destination = server_directory.join(CONFIG_SCOPE_DIR);
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|err| err.to_string())?;
        }
        copy_dir_filtered(&config_dir_source, &destination)?;
        restored_configs = true;
    }
    if restored_configs {
        restored.push("configs".to_string());
    }

    if restored.is_empty() {
        return Err("Selected backup has no restorable contents.".to_string());
    }

    Ok(restored)
}

pub(in crate::app) fn copy_dir_filtered(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|err| err.to_string())?;

    for entry in WalkDir::new(source).into_iter().flatten() {
        let entry_path = entry.path();
        let relative = entry_path
            .strip_prefix(source)
            .map_err(|err| err.to_string())?;
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
        return Err(format!(
            "Swap completed partially. Manual fix may be required: {err}"
        ));
    }

    Ok(())
}

pub(in crate::app) fn extract_zip_to_directory(
    zip_path: &Path,
    destination: &Path,
) -> Result<(), String> {
    let zip_file = fs::File::open(zip_path).map_err(|err| err.to_string())?;
    let mut archive = zip::ZipArchive::new(zip_file).map_err(|err| err.to_string())?;

    fs::create_dir_all(destination).map_err(|err| err.to_string())?;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|err| err.to_string())?;
        let enclosed = file
            .enclosed_name()
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

/// Extracts a `.tar.gz` archive into `destination`. Used for Adoptium Java
/// downloads, which ship as tarballs on Linux/macOS (zip on Windows). The tar
/// crate's `unpack` sanitizes entry paths and preserves the Unix permission
/// bits, so extracted `bin/java` stays executable.
#[cfg(unix)]
pub(in crate::app) fn extract_tar_gz_to_directory(
    archive_path: &Path,
    destination: &Path,
) -> Result<(), String> {
    let file = fs::File::open(archive_path).map_err(|err| err.to_string())?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);

    fs::create_dir_all(destination).map_err(|err| err.to_string())?;
    archive.unpack(destination).map_err(|err| err.to_string())
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
    file.read_to_end(&mut buffer)
        .map_err(|err| err.to_string())?;
    writer.write_all(&buffer).map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR_MILLIS: i64 = 60 * 60 * 1000;
    const DAY_MILLIS: i64 = 24 * HOUR_MILLIS;

    fn write_mserve_json(directory: &Path, extra: serde_json::Value) {
        let mut base = serde_json::json!({
            "id": "srv-test",
            "file": "server.jar",
            "ram": 4.0,
            "storage_limit": 200,
        });
        base.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        fs::write(
            directory.join("mserve.json"),
            serde_json::to_vec_pretty(&base).unwrap(),
        )
        .unwrap();
    }

    fn make_backup_at(
        directory: &Path,
        name: &str,
        created: chrono::DateTime<chrono::Local>,
        locked: bool,
    ) -> PathBuf {
        let backup_dir = directory.join(".backups").join(name);
        fs::create_dir_all(&backup_dir).unwrap();
        fs::write(backup_dir.join("payload.bin"), vec![0_u8; 16]).unwrap();

        let metadata = BackupSnapshotMetadata {
            created_at: created.to_rfc3339(),
            size: 16,
            locked,
            ..BackupSnapshotMetadata::default()
        };
        write_backup_metadata(&backup_dir, &metadata).unwrap();
        backup_dir
    }

    fn make_backup(directory: &Path, name: &str, age_millis: i64, locked: bool) -> PathBuf {
        let created = chrono::Local::now() - chrono::Duration::milliseconds(age_millis);
        make_backup_at(directory, name, created, locked)
    }

    #[test]
    fn smart_bucket_keeps_everything_recent() {
        let now = chrono::Local::now().timestamp_millis();
        assert_eq!(smart_retention_bucket(now - HOUR_MILLIS, now), None);
        assert_eq!(
            smart_retention_bucket(now - (SMART_KEEP_ALL_HOURS - 1) * HOUR_MILLIS, now),
            None
        );
        // Older than the keep-all window lands in a daily bucket.
        assert!(
            smart_retention_bucket(now - 3 * DAY_MILLIS, now)
                .is_some_and(|bucket| bucket.starts_with("day-"))
        );
        // Then weekly, then monthly.
        assert!(
            smart_retention_bucket(now - 30 * DAY_MILLIS, now)
                .is_some_and(|bucket| bucket.starts_with("week-"))
        );
        assert!(
            smart_retention_bucket(now - 90 * DAY_MILLIS, now)
                .is_some_and(|bucket| bucket.starts_with("month-"))
        );
    }

    #[test]
    fn count_cap_deletes_oldest_unlocked_first() {
        let dir = tempfile::tempdir().unwrap();
        write_mserve_json(
            dir.path(),
            serde_json::json!({ "backup_policy": "simple", "backup_max_count": 2 }),
        );

        let oldest = make_backup(dir.path(), "a-oldest", 3 * HOUR_MILLIS, false);
        let middle = make_backup(dir.path(), "b-middle", 2 * HOUR_MILLIS, false);
        let newest = make_backup(dir.path(), "c-newest", HOUR_MILLIS, false);

        let deleted = enforce_backup_retention(dir.path(), &[], false).unwrap();
        assert_eq!(deleted, 1);
        assert!(!oldest.exists());
        assert!(middle.exists());
        assert!(newest.exists());
    }

    #[test]
    fn locked_backups_survive_every_cap() {
        let dir = tempfile::tempdir().unwrap();
        write_mserve_json(
            dir.path(),
            serde_json::json!({
                "backup_policy": "simple",
                "backup_max_count": 1,
                "backup_max_age_days": 1,
            }),
        );

        let locked_old = make_backup(dir.path(), "a-locked", 10 * DAY_MILLIS, true);
        let unlocked_old = make_backup(dir.path(), "b-unlocked", 9 * DAY_MILLIS, false);
        let newest = make_backup(dir.path(), "c-newest", HOUR_MILLIS, false);

        let deleted = enforce_backup_retention(dir.path(), &[], false).unwrap();
        assert_eq!(deleted, 1);
        // The locked backup survives both the age and count caps (the cap is
        // best-effort when locked backups overflow it); the newest unlocked
        // backup claims the single slot.
        assert!(locked_old.exists());
        assert!(!unlocked_old.exists());
        assert!(newest.exists());
    }

    #[test]
    fn smart_policy_thins_same_day_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        write_mserve_json(dir.path(), serde_json::json!({ "backup_policy": "smart" }));

        // Two backups on the same calendar day ~5 days ago collapse to the
        // newer one; recent backups are untouched. Fixed noon timestamps keep
        // both on the same local day regardless of when the test runs.
        let noon_five_days_ago = chrono::Local::now()
            .date_naive()
            .checked_sub_days(chrono::Days::new(5))
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap()
            .and_local_timezone(chrono::Local)
            .unwrap();
        let old_early = make_backup_at(
            dir.path(),
            "a-early",
            noon_five_days_ago - chrono::Duration::hours(2),
            false,
        );
        let old_late = make_backup_at(dir.path(), "b-late", noon_five_days_ago, false);
        let recent_one = make_backup(dir.path(), "c-recent1", 2 * HOUR_MILLIS, false);
        let recent_two = make_backup(dir.path(), "d-recent2", HOUR_MILLIS, false);

        let deleted = enforce_backup_retention(dir.path(), &[], false).unwrap();
        assert_eq!(deleted, 1);
        assert!(!old_early.exists());
        assert!(old_late.exists());
        assert!(recent_one.exists());
        assert!(recent_two.exists());
    }

    #[test]
    fn protected_backups_are_treated_as_locked() {
        let dir = tempfile::tempdir().unwrap();
        write_mserve_json(
            dir.path(),
            serde_json::json!({ "backup_policy": "simple", "backup_max_age_days": 1 }),
        );

        let protected = make_backup(dir.path(), "a-protected", 10 * DAY_MILLIS, false);
        let doomed = make_backup(dir.path(), "b-doomed", 10 * DAY_MILLIS, false);

        let deleted =
            enforce_backup_retention(dir.path(), std::slice::from_ref(&protected), false).unwrap();
        assert_eq!(deleted, 1);
        assert!(protected.exists());
        assert!(!doomed.exists());
    }

    #[test]
    fn detects_contents_of_legacy_backup_layout() {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join(".backups").join("legacy");
        fs::create_dir_all(backup.join("world")).unwrap();
        fs::write(backup.join("world").join("level.dat"), b"nbt").unwrap();
        fs::create_dir_all(backup.join("plugins")).unwrap();

        let contents = detect_backup_contents(&backup);
        assert_eq!(contents, vec!["worlds".to_string(), "plugins".to_string()]);
    }
}
