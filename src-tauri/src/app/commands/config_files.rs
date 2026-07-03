use super::super::support::apply_properties;
use super::super::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const MANAGED_CONFIG_FILE_NAMES: [&str; 10] = [
    "server.properties",
    "ops.json",
    "whitelist.json",
    "banned-ips.json",
    "banned-players.json",
    "bukkit.yml",
    "help.yml",
    "commands.yml",
    "spigot.yml",
    "velocity.toml",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedConfigFileRequest {
    directory: String,
    file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedConfigFileWritePayload {
    directory: String,
    file_name: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedConfigFileStatus {
    file_name: String,
    exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedConfigFileContent {
    file_name: String,
    content: String,
}

fn normalize_managed_config_file_name(file_name: &str) -> Result<&'static str, String> {
    let normalized = file_name.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("Config file name is required.".to_string());
    }

    MANAGED_CONFIG_FILE_NAMES
        .iter()
        .copied()
        .find(|candidate| *candidate == normalized)
        .ok_or_else(|| format!("Unsupported config file: {file_name}"))
}

fn resolve_managed_config_file_path(
    directory: &str,
    file_name: &str,
) -> Result<(PathBuf, &'static str), String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let resolved_name = normalize_managed_config_file_name(file_name)?;
    Ok((directory_path.join(resolved_name), resolved_name))
}

#[tauri::command]
pub(in crate::app) fn scan_managed_server_config_files(
    directory: String,
) -> Result<Vec<ManagedConfigFileStatus>, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    Ok(MANAGED_CONFIG_FILE_NAMES
        .iter()
        .map(|file_name| ManagedConfigFileStatus {
            file_name: (*file_name).to_string(),
            exists: directory_path.join(file_name).exists(),
        })
        .collect())
}

#[tauri::command]
pub(in crate::app) fn read_managed_server_config_file(
    payload: ManagedConfigFileRequest,
) -> Result<ManagedConfigFileContent, String> {
    let (file_path, file_name) =
        resolve_managed_config_file_path(&payload.directory, &payload.file_name)?;
    let content = fs::read_to_string(&file_path).map_err(|err| err.to_string())?;

    Ok(ManagedConfigFileContent {
        file_name: file_name.to_string(),
        content,
    })
}

#[tauri::command]
pub(in crate::app) fn write_managed_server_config_file(
    payload: ManagedConfigFileWritePayload,
) -> Result<ManagedConfigFileContent, String> {
    let (file_path, file_name) =
        resolve_managed_config_file_path(&payload.directory, &payload.file_name)?;
    fs::write(&file_path, payload.content.as_bytes()).map_err(|err| err.to_string())?;

    Ok(ManagedConfigFileContent {
        file_name: file_name.to_string(),
        content: payload.content,
    })
}

/// Keys the security audit / featured-property editor is allowed to write via
/// `apply_server_properties`. Restricting the set keeps this targeted command
/// from becoming a general-purpose arbitrary-key writer.
const APPLY_ALLOWED_KEYS: [&str; 18] = [
    "online-mode",
    "white-list",
    "enforce-whitelist",
    "enforce-secure-profile",
    "rate-limit",
    "prevent-proxy-connections",
    "spawn-protection",
    "network-compression-threshold",
    "broadcast-rcon-to-ops",
    "hide-online-players",
    "max-players",
    "view-distance",
    "simulation-distance",
    "difficulty",
    "gamemode",
    "motd",
    "pvp",
    "allow-flight",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PropertyUpdate {
    key: String,
    value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplyServerPropertiesPayload {
    directory: String,
    updates: Vec<PropertyUpdate>,
}

/// Idempotently applies a set of `server.properties` key/value pairs, preserving
/// comments and ordering (unlike a whole-file rewrite). Only allow-listed keys
/// are accepted. Used by the security audit's one-click hardening fixes.
#[tauri::command]
pub(in crate::app) fn apply_server_properties(
    payload: ApplyServerPropertiesPayload,
) -> Result<(), String> {
    let directory_path = PathBuf::from(payload.directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }
    if payload.updates.is_empty() {
        return Ok(());
    }

    let mut normalized: Vec<(&'static str, String)> = Vec::with_capacity(payload.updates.len());
    for update in &payload.updates {
        let key = update.key.trim().to_lowercase();
        let allowed = APPLY_ALLOWED_KEYS
            .iter()
            .copied()
            .find(|candidate| *candidate == key)
            .ok_or_else(|| format!("Property '{}' cannot be changed here.", update.key))?;
        normalized.push((allowed, update.value.trim().to_string()));
    }

    apply_server_properties_to_dir(&directory_path, &normalized)
}

/// Thin wrapper so the write can be unit-tested against a temp directory.
fn apply_server_properties_to_dir(
    directory: &Path,
    updates: &[(&str, String)],
) -> Result<(), String> {
    apply_properties(directory, updates)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_rejects_keys_outside_the_allowlist() {
        let dir = tempfile::tempdir().unwrap();
        let payload = ApplyServerPropertiesPayload {
            directory: dir.path().to_string_lossy().to_string(),
            updates: vec![PropertyUpdate {
                key: "rcon.password".to_string(),
                value: "hunter2".to_string(),
            }],
        };
        assert!(apply_server_properties(payload).is_err());
    }

    #[test]
    fn apply_preserves_comments_and_other_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("server.properties");
        std::fs::write(
            &path,
            "# a comment\nmotd=Hello\nonline-mode=false\nlevel-name=world\n",
        )
        .unwrap();

        apply_server_properties_to_dir(
            dir.path(),
            &[
                ("online-mode", "true".to_string()),
                ("white-list", "true".to_string()),
            ],
        )
        .unwrap();

        let result = std::fs::read_to_string(&path).unwrap();
        assert!(result.contains("# a comment"));
        assert!(result.contains("online-mode=true"));
        assert!(result.contains("level-name=world"));
        assert!(result.contains("white-list=true"));
        // The pre-existing motd line is untouched.
        assert!(result.contains("motd=Hello"));
    }
}
