use super::super::*;
use std::fs;
use std::path::PathBuf;

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
	let (file_path, file_name) = resolve_managed_config_file_path(&payload.directory, &payload.file_name)?;
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
	let (file_path, file_name) = resolve_managed_config_file_path(&payload.directory, &payload.file_name)?;
	fs::write(&file_path, payload.content.as_bytes()).map_err(|err| err.to_string())?;

	Ok(ManagedConfigFileContent {
		file_name: file_name.to_string(),
		content: payload.content,
	})
}