use super::super::{ScannedDatapack, ScannedPlugin, ScannedWorld};
use std::collections::HashMap;
use std::fs;
use std::net::{IpAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub(in crate::app) fn to_alpha_prefix(value: &str) -> Option<String> {
    let mut output = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphabetic() || ch == '_' {
            output.push(ch);
        } else {
            break;
        }
    }

    if output.is_empty() {
        None
    } else {
        Some(output)
    }
}

pub(in crate::app) fn infer_plugin_name(file_name: &str, explicit: bool) -> Option<String> {
    let without_ext = file_name.strip_suffix(".jar").unwrap_or(file_name);
    if explicit {
        return Some(without_ext.to_string());
    }

    if let Some(prefix) = to_alpha_prefix(without_ext) {
        return Some(prefix);
    }

    let first = without_ext
        .split(|ch: char| ch == '-' || ch == '_' || ch == ' ' || ch.is_ascii_digit())
        .find(|segment| !segment.is_empty())
        .unwrap_or(without_ext);

    if first.is_empty() {
        None
    } else {
        Some(first.to_string())
    }
}

pub(in crate::app) fn infer_datapack_name(file_name: &str, explicit: bool) -> Option<String> {
    let base = file_name.strip_suffix(".zip").unwrap_or(file_name);
    if explicit {
        return Some(base.to_string());
    }

    let normalized = base
        .chars()
        .map(|ch| if ch.is_ascii_alphabetic() { ch } else { ' ' })
        .collect::<String>()
        .replace("MC", "")
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ");

    if normalized.is_empty() {
        Some(base.to_string())
    } else {
        Some(normalized)
    }
}

pub(in crate::app) fn resolve_local_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let local_addr = socket.local_addr().ok()?;

    match local_addr.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() => Some(ip.to_string()),
        IpAddr::V6(ip) if !ip.is_loopback() => Some(ip.to_string()),
        _ => None,
    }
}

/// Fetches the machine's public (internet-facing) IP from an external service.
/// Returns `None` if the request fails or the response cannot be parsed.
pub(in crate::app) fn resolve_public_ip() -> Option<String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .ok()?;
    let response = client.get("https://api.ipify.org").send().ok()?;
    if !response.status().is_success() {
        return None;
    }
    let text = response.text().ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

pub(in crate::app) fn path_size_bytes(path: &Path) -> u64 {
    let Ok(metadata) = fs::metadata(path) else {
        return 0;
    };

    if metadata.is_file() {
        return metadata.len();
    }

    if !metadata.is_dir() {
        return 0;
    }

    let mut total = 0_u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            total = total.saturating_add(path_size_bytes(&entry.path()));
        }
    }

    total
}

/// Walks `dir`, handing each entry's path + file name to `make`. `make` returns
/// `Some(item)` to keep the entry (applying its own type-specific filter) or
/// `None` to skip it. Missing/non-directory paths are silently ignored.
fn read_dir_items<T>(
    dir: &Path,
    activated: bool,
    into: &mut Vec<T>,
    mut make: impl FnMut(&Path, &str, bool) -> Option<T>,
) {
    if !dir.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if let Some(item) = make(&path, file_name, activated) {
            into.push(item);
        }
    }
}

/// De-duplicates scanned items by lowercased file name (preferring an activated
/// copy over an inactive one) and returns them sorted by that key.
fn dedup_by_file<T>(
    items: Vec<T>,
    file_of: impl Fn(&T) -> &str,
    is_activated: impl Fn(&T) -> bool,
) -> Vec<T> {
    let mut deduped: HashMap<String, T> = HashMap::new();
    for item in items {
        let key = file_of(&item).to_lowercase();
        if deduped.get(&key).is_some_and(&is_activated) {
            continue;
        }
        deduped.insert(key, item);
    }

    let mut result: Vec<T> = deduped.into_values().collect();
    result.sort_by_key(|item| file_of(item).to_lowercase());
    result
}

pub(in crate::app) fn list_plugins(directory: &Path, explicit: bool) -> Vec<ScannedPlugin> {
    let mut plugins = vec![];
    let read = |dir: PathBuf, activated: bool, into: &mut Vec<ScannedPlugin>| {
        read_dir_items(&dir, activated, into, |path, file_name, activated| {
            if !path.is_file()
                || !Path::new(file_name)
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("jar"))
            {
                return None;
            }
            Some(ScannedPlugin {
                name: infer_plugin_name(file_name, explicit),
                file: file_name.to_string(),
                url: None,
                size: fs::metadata(path).ok().map(|metadata| metadata.len()),
                activated,
            })
        });
    };

    read(directory.join("plugins"), true, &mut plugins);
    read(
        directory.join("inactive").join("plugins"),
        false,
        &mut plugins,
    );

    dedup_by_file(plugins, |plugin| &plugin.file, |plugin| plugin.activated)
}

pub(in crate::app) fn list_worlds(directory: &Path) -> Vec<ScannedWorld> {
    let mut worlds = vec![];
    let read =
        |dir: PathBuf, activated: bool, use_detection: bool, into: &mut Vec<ScannedWorld>| {
            read_dir_items(&dir, activated, into, |path, name, activated| {
                if !path.is_dir() {
                    return None;
                }
                let looks_like_world = !use_detection
                    || name.eq_ignore_ascii_case("world")
                    || name.eq_ignore_ascii_case("world_nether")
                    || name.eq_ignore_ascii_case("world_the_end")
                    || path.join("level.dat").exists();
                if !looks_like_world {
                    return None;
                }
                Some(ScannedWorld {
                    name: Some(name.to_string()),
                    file: name.to_string(),
                    size: Some(path_size_bytes(path)),
                    activated,
                })
            });
        };

    read(directory.to_path_buf(), true, true, &mut worlds);
    read(
        directory.join("inactive").join("worlds"),
        false,
        false,
        &mut worlds,
    );

    dedup_by_file(worlds, |world| &world.file, |world| world.activated)
}

pub(in crate::app) fn list_datapacks(directory: &Path, explicit: bool) -> Vec<ScannedDatapack> {
    let mut datapacks = vec![];
    let read = |dir: PathBuf, activated: bool, into: &mut Vec<ScannedDatapack>| {
        read_dir_items(&dir, activated, into, |path, file_name, activated| {
            let is_zip = path.extension().and_then(|ext| ext.to_str()) == Some("zip");
            if !(path.is_dir() || is_zip) {
                return None;
            }
            Some(ScannedDatapack {
                name: infer_datapack_name(file_name, explicit),
                file: file_name.to_string(),
                activated,
            })
        });
    };

    read(
        directory.join("world").join("datapacks"),
        true,
        &mut datapacks,
    );
    read(
        directory.join("inactive").join("datapacks"),
        false,
        &mut datapacks,
    );

    dedup_by_file(
        datapacks,
        |datapack| &datapack.file,
        |datapack| datapack.activated,
    )
}
