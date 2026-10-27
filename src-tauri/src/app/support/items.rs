use super::super::{ItemActionPayload, ToggleItemPayload};
use std::fs;
use std::path::{Component, Path, PathBuf};

/// True for a bare file/folder name: exactly one normal path component, so it
/// can't escape (or *be*) its slot root. Rejects `.`, `..` and separators; on
/// Windows a drive-relative `C:x` parses as a prefix component and fails too.
pub(in crate::app) fn is_simple_relative_name(name: &str) -> bool {
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        return false;
    }
    let mut components = Path::new(name).components();
    matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(_)), None)
    )
}

pub(in crate::app) fn item_roots(
    directory: &Path,
    item_type: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let inactive_root = directory.join("inactive");
    match item_type {
        "plugin" => Ok((directory.join("plugins"), inactive_root.join("plugins"))),
        "mod" => Ok((directory.join("mods"), inactive_root.join("mods"))),
        "world" => Ok((directory.to_path_buf(), inactive_root.join("worlds"))),
        "datapack" => Ok((
            directory.join("world").join("datapacks"),
            inactive_root.join("datapacks"),
        )),
        _ => Err("Unsupported item type.".to_string()),
    }
}

pub(in crate::app) fn resolve_item_locations(
    directory: &Path,
    item_type: &str,
    file: &str,
) -> Result<(PathBuf, PathBuf), String> {
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

    let (active_path, inactive_path) =
        resolve_item_locations(&directory, payload.item_type.as_str(), file)?;
    let target = if active_path.exists() {
        active_path
    } else if inactive_path.exists() {
        inactive_path
    } else {
        return Err("Item not found.".to_string());
    };

    trash::delete(&target).map_err(|err| err.to_string())?;
    super::content_meta::forget_content_meta(&directory, payload.item_type.as_str(), file);
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
    // `rename` silently replaces a same-named file, which would destroy the
    // other copy (the scan only shows one of them).
    if to_path.exists() {
        return Err(format!(
            "An item named \"{file}\" already exists in the {} folder. Remove one copy first.",
            if payload.activate {
                "active"
            } else {
                "disabled"
            }
        ));
    }

    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    fs::rename(&from_path, &to_path).map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_names_are_single_normal_components() {
        assert!(is_simple_relative_name("world"));
        assert!(is_simple_relative_name("WorldEdit-7.3.jar"));
        assert!(is_simple_relative_name(".hidden"));
        assert!(!is_simple_relative_name(""));
        assert!(!is_simple_relative_name("."));
        assert!(!is_simple_relative_name(".."));
        assert!(!is_simple_relative_name("a/b"));
        assert!(!is_simple_relative_name("a\\b"));
        // Drive-relative on Windows; an ordinary name elsewhere.
        assert_eq!(is_simple_relative_name("C:evil"), !cfg!(windows));
    }

    #[test]
    fn toggle_refuses_to_overwrite_a_same_named_item() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("plugins")).unwrap();
        fs::create_dir_all(dir.path().join("inactive").join("plugins")).unwrap();
        fs::write(dir.path().join("plugins").join("Foo.jar"), b"new").unwrap();
        fs::write(
            dir.path().join("inactive").join("plugins").join("Foo.jar"),
            b"old",
        )
        .unwrap();

        let result = toggle_item_activation(ToggleItemPayload {
            directory: dir.path().to_string_lossy().to_string(),
            item_type: "plugin".to_string(),
            file: "Foo.jar".to_string(),
            activate: false,
        });
        assert!(result.is_err());
        assert_eq!(
            fs::read(dir.path().join("inactive").join("plugins").join("Foo.jar")).unwrap(),
            b"old"
        );
    }
}
