use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Sidecar file in the server directory recording where managed content items
/// (plugins, datapacks, mods) came from. Keyed by item type, then by file name.
/// The scanner joins this back in so installed items keep their catalog name
/// and project page URL across sessions.
const CONTENT_META_FILE: &str = ".mserve-content.json";

/// Serializes sidecar read-modify-writes so concurrent installs/deletes can't
/// drop each other's entries.
static CONTENT_META_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(in crate::app) struct ContentItemMeta {
    pub name: String,
    pub project_id: String,
    pub version_id: String,
    pub page_url: String,
    pub source: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(in crate::app) struct ContentMeta {
    #[serde(default)]
    pub items: BTreeMap<String, BTreeMap<String, ContentItemMeta>>,
}

fn content_meta_path(directory: &Path) -> PathBuf {
    directory.join(CONTENT_META_FILE)
}

pub(in crate::app) fn read_content_meta(directory: &Path) -> ContentMeta {
    fs::read_to_string(content_meta_path(directory))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Writes via a temp file + rename so a crash can't leave a truncated sidecar.
fn write_content_meta(directory: &Path, meta: &ContentMeta) -> Result<(), String> {
    let text = serde_json::to_string_pretty(meta).map_err(|err| err.to_string())?;
    let path = content_meta_path(directory);
    let temp_path = directory.join(format!("{CONTENT_META_FILE}.tmp"));
    fs::write(&temp_path, text).map_err(|err| err.to_string())?;
    fs::rename(&temp_path, &path).map_err(|err| {
        let _ = fs::remove_file(&temp_path);
        err.to_string()
    })
}

pub(in crate::app) fn record_content_meta(
    directory: &Path,
    item_type: &str,
    file: &str,
    item: ContentItemMeta,
) -> Result<(), String> {
    let _guard = CONTENT_META_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut meta = read_content_meta(directory);
    meta.items
        .entry(item_type.to_string())
        .or_default()
        .insert(file.to_string(), item);
    write_content_meta(directory, &meta)
}

/// Best-effort removal of a sidecar entry when the underlying item is deleted.
pub(in crate::app) fn forget_content_meta(directory: &Path, item_type: &str, file: &str) {
    let _guard = CONTENT_META_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut meta = read_content_meta(directory);
    let Some(entries) = meta.items.get_mut(item_type) else {
        return;
    };
    if entries.remove(file).is_none() {
        return;
    }
    if entries.is_empty() {
        meta.items.remove(item_type);
    }
    let _ = write_content_meta(directory, &meta);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_forgets_entries() {
        let dir = tempfile::tempdir().unwrap();
        record_content_meta(
            dir.path(),
            "plugin",
            "worldedit.jar",
            ContentItemMeta {
                name: "WorldEdit".to_string(),
                project_id: "1u6JkXh5".to_string(),
                version_id: "abc123".to_string(),
                page_url: "https://modrinth.com/plugin/worldedit".to_string(),
                source: "modrinth".to_string(),
            },
        )
        .unwrap();

        let meta = read_content_meta(dir.path());
        let entry = &meta.items["plugin"]["worldedit.jar"];
        assert_eq!(entry.name, "WorldEdit");
        assert_eq!(entry.page_url, "https://modrinth.com/plugin/worldedit");

        forget_content_meta(dir.path(), "plugin", "worldedit.jar");
        let meta = read_content_meta(dir.path());
        assert!(meta.items.is_empty());
    }

    #[test]
    fn missing_or_invalid_sidecar_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_content_meta(dir.path()).items.is_empty());

        fs::write(dir.path().join(".mserve-content.json"), "not json").unwrap();
        assert!(read_content_meta(dir.path()).items.is_empty());
    }
}
