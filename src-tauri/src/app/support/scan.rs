use super::super::*;
use std::collections::HashMap;
use std::fs;
use std::net::{IpAddr, UdpSocket};
use std::path::{Path, PathBuf};

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

pub(in crate::app) fn list_plugins(directory: &Path, explicit: bool) -> Vec<ScannedPlugin> {
    let mut plugins = vec![];

    let read_plugins = |dir: PathBuf, activated: bool, into: &mut Vec<ScannedPlugin>| {
        if !dir.exists() || !dir.is_dir() {
            return;
        }

        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }

                let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                    continue;
                };

                if !file_name.ends_with(".jar") {
                    continue;
                }

                let size = fs::metadata(&path).ok().map(|metadata| metadata.len());

                into.push(ScannedPlugin {
                    name: infer_plugin_name(file_name, explicit),
                    file: file_name.to_string(),
                    url: None,
                    size,
                    activated,
                });
            }
        }
    };

    read_plugins(directory.join("plugins"), true, &mut plugins);
    read_plugins(directory.join("inactive").join("plugins"), false, &mut plugins);

    let mut deduped: HashMap<String, ScannedPlugin> = HashMap::new();
    for plugin in plugins {
        let key = plugin.file.to_lowercase();
        if let Some(existing) = deduped.get(&key) {
            if existing.activated {
                continue;
            }
        }
        deduped.insert(key, plugin);
    }

    let mut result: Vec<ScannedPlugin> = deduped.into_values().collect();
    result.sort_by(|a, b| a.file.to_lowercase().cmp(&b.file.to_lowercase()));
    result
}

pub(in crate::app) fn list_worlds(directory: &Path) -> Vec<ScannedWorld> {
    let mut worlds = vec![];

    let read_worlds = |dir: PathBuf,
                       activated: bool,
                       use_active_detection: bool,
                       into: &mut Vec<ScannedWorld>| {
        if !dir.exists() || !dir.is_dir() {
            return;
        }

        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                let Some(name) = path.file_name().and_then(|file_name| file_name.to_str()) else {
                    continue;
                };

                let looks_like_world = if use_active_detection {
                    name.eq_ignore_ascii_case("world")
                        || name.eq_ignore_ascii_case("world_nether")
                        || name.eq_ignore_ascii_case("world_the_end")
                        || path.join("level.dat").exists()
                } else {
                    true
                };

                if !looks_like_world {
                    continue;
                }

                into.push(ScannedWorld {
                    name: Some(name.to_string()),
                    file: name.to_string(),
                    size: Some(path_size_bytes(&path)),
                    activated,
                });
            }
        }
    };

    read_worlds(directory.to_path_buf(), true, true, &mut worlds);
    read_worlds(
        directory.join("inactive").join("worlds"),
        false,
        false,
        &mut worlds,
    );

    let mut deduped: HashMap<String, ScannedWorld> = HashMap::new();
    for world in worlds {
        let key = world.file.to_lowercase();
        if let Some(existing) = deduped.get(&key) {
            if existing.activated {
                continue;
            }
        }
        deduped.insert(key, world);
    }

    let mut result: Vec<ScannedWorld> = deduped.into_values().collect();
    result.sort_by(|a, b| a.file.to_lowercase().cmp(&b.file.to_lowercase()));
    result
}

pub(in crate::app) fn list_datapacks(directory: &Path, explicit: bool) -> Vec<ScannedDatapack> {
    let mut datapacks = vec![];

    let read_datapacks = |dir: PathBuf, activated: bool, into: &mut Vec<ScannedDatapack>| {
        if !dir.exists() || !dir.is_dir() {
            return;
        }

        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let is_zip = path.extension().and_then(|ext| ext.to_str()) == Some("zip");

                if !(path.is_dir() || is_zip) {
                    continue;
                }

                let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                    continue;
                };

                into.push(ScannedDatapack {
                    name: infer_datapack_name(file_name, explicit),
                    file: file_name.to_string(),
                    activated,
                });
            }
        }
    };

    read_datapacks(directory.join("world").join("datapacks"), true, &mut datapacks);
    read_datapacks(
        directory.join("inactive").join("datapacks"),
        false,
        &mut datapacks,
    );

    let mut deduped: HashMap<String, ScannedDatapack> = HashMap::new();
    for datapack in datapacks {
        let key = datapack.file.to_lowercase();
        if let Some(existing) = deduped.get(&key) {
            if existing.activated {
                continue;
            }
        }
        deduped.insert(key, datapack);
    }

    let mut result: Vec<ScannedDatapack> = deduped.into_values().collect();
    result.sort_by(|a, b| a.file.to_lowercase().cmp(&b.file.to_lowercase()));
    result
}

