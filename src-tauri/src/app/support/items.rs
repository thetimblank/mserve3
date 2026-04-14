use super::super::*;
use std::fs;
use std::path::{Path, PathBuf};

pub(in crate::app) fn is_simple_relative_name(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.contains("..")
}

pub(in crate::app) fn item_roots(directory: &Path, item_type: &str) -> Result<(PathBuf, PathBuf), String> {
    let inactive_root = directory.join("inactive");
    match item_type {
        "plugin" => Ok((directory.join("plugins"), inactive_root.join("plugins"))),
        "world" => Ok((directory.to_path_buf(), inactive_root.join("worlds"))),
        "datapack" => Ok((directory.join("world").join("datapacks"), inactive_root.join("datapacks"))),
        _ => Err("Unsupported item type.".to_string()),
    }
}

pub(in crate::app) fn resolve_item_locations(directory: &Path, item_type: &str, file: &str) -> Result<(PathBuf, PathBuf), String> {
    let (active_parent, inactive_parent) = item_roots(directory, item_type)?;
    Ok((active_parent.join(file), inactive_parent.join(file)))
}

pub(in crate::app) fn remove_item_to_trash(payload: &ItemActionPayload) -> Result<(), String> {
    let directory = PathBuf::from(payload.directory.trim());
    if !directory.exists() || !directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let file = payload.file.trim();
    if !is_simple_relative_name(file) {
        return Err("Invalid item path.".to_string());
    }

    let (active_path, inactive_path) = resolve_item_locations(&directory, payload.item_type.as_str(), file)?;
    let target = if active_path.exists() {
        active_path
    } else if inactive_path.exists() {
        inactive_path
    } else {
        return Err("Item not found.".to_string());
    };

    trash::delete(&target).map_err(|err| err.to_string())?;
    Ok(())
}


pub(in crate::app) fn toggle_item_activation(payload: ToggleItemPayload) -> Result<(), String> {
    let directory = PathBuf::from(payload.directory.trim());
    if !directory.exists() || !directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let file = payload.file.trim();
    if !is_simple_relative_name(file) {
        return Err("Invalid item path.".to_string());
    }

    let (active_parent, inactive_parent) = item_roots(&directory, payload.item_type.as_str())?;

    let from_path = if payload.activate {
        inactive_parent.join(file)
    } else {
        active_parent.join(file)
    };

    let to_path = if payload.activate {
        active_parent.join(file)
    } else {
        inactive_parent.join(file)
    };

    if !from_path.exists() {
        return Err("Item not found in expected source location.".to_string());
    }

    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    fs::rename(&from_path, &to_path).map_err(|err| err.to_string())?;
    Ok(())
}
