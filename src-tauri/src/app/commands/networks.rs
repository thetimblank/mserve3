use super::super::support::{read_optional_file, write_file_creating_dirs};
use super::super::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

const NETWORKS_CONFIG_FILE_NAME: &str = "networks.json";

/// Relative paths (under a server directory) that the network system is allowed
/// to read/write outside of the top-level managed-config whitelist. These are the
/// extra files Velocity modern forwarding needs.
const MANAGED_NETWORK_FILE_NAMES: [&str; 2] = ["forwarding.secret", "config/paper-global.yml"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworksConfigReadPayload {
    root_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworksConfigWritePayload {
    root_path: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworksConfigContent {
    /// `None` when the networks file has not been created yet.
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerNetworkFileReadPayload {
    directory: String,
    relative: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerNetworkFileWritePayload {
    directory: String,
    relative: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerNetworkFileContent {
    relative: String,
    exists: bool,
    /// `None` when the file does not exist yet.
    content: Option<String>,
}

fn resolve_networks_config_path(root_path: &str) -> Result<PathBuf, String> {
    let trimmed = root_path.trim();
    if trimmed.is_empty() {
        return Err("Servers root path is required.".to_string());
    }

    Ok(PathBuf::from(trimmed).join(NETWORKS_CONFIG_FILE_NAME))
}

/// Normalize and validate a network-managed relative file path, rejecting any
/// path traversal or absolute components. Returns the canonical whitelist entry.
fn normalize_managed_network_file(relative: &str) -> Result<&'static str, String> {
    let normalized = relative.trim().replace('\\', "/").to_lowercase();
    if normalized.is_empty() {
        return Err("Network file path is required.".to_string());
    }

    MANAGED_NETWORK_FILE_NAMES
        .iter()
        .copied()
        .find(|candidate| *candidate == normalized)
        .ok_or_else(|| format!("Unsupported network file: {relative}"))
}

fn resolve_server_network_file_path(
    directory: &str,
    relative: &str,
) -> Result<(PathBuf, &'static str), String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let resolved = normalize_managed_network_file(relative)?;

    // Defense in depth: ensure the resolved relative path has no traversal
    // components even though it comes from a fixed whitelist.
    let relative_path = Path::new(resolved);
    if relative_path
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::RootDir))
    {
        return Err("Invalid network file path.".to_string());
    }

    Ok((directory_path.join(relative_path), resolved))
}

#[tauri::command]
pub(in crate::app) fn read_networks_config(
    payload: NetworksConfigReadPayload,
) -> Result<NetworksConfigContent, String> {
    let path = resolve_networks_config_path(&payload.root_path)?;
    Ok(NetworksConfigContent {
        content: read_optional_file(&path)?,
    })
}

#[tauri::command]
pub(in crate::app) fn write_networks_config(
    payload: NetworksConfigWritePayload,
) -> Result<NetworksConfigContent, String> {
    let path = resolve_networks_config_path(&payload.root_path)?;
    write_file_creating_dirs(&path, &payload.content)?;
    Ok(NetworksConfigContent {
        content: Some(payload.content),
    })
}

#[tauri::command]
pub(in crate::app) fn read_server_network_file(
    payload: ServerNetworkFileReadPayload,
) -> Result<ServerNetworkFileContent, String> {
    let (file_path, relative) =
        resolve_server_network_file_path(&payload.directory, &payload.relative)?;

    let content = read_optional_file(&file_path)?;
    Ok(ServerNetworkFileContent {
        relative: relative.to_string(),
        exists: content.is_some(),
        content,
    })
}

#[tauri::command]
pub(in crate::app) fn write_server_network_file(
    payload: ServerNetworkFileWritePayload,
) -> Result<ServerNetworkFileContent, String> {
    let (file_path, relative) =
        resolve_server_network_file_path(&payload.directory, &payload.relative)?;

    write_file_creating_dirs(&file_path, &payload.content)?;
    Ok(ServerNetworkFileContent {
        relative: relative.to_string(),
        exists: true,
        content: Some(payload.content),
    })
}
