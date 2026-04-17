mod commands;
mod support;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Child, ChildStdin};
use std::sync::Mutex;

use commands::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InitServerPayload {
    directory: String,
    create_directory_if_missing: bool,
    file: String,
    ram: u32,
    storage_limit: Option<u32>,
    auto_restart: bool,
    auto_backup: Vec<String>,
    auto_backup_interval: u32,
    auto_agree_eula: bool,
    java_installation: Option<String>,
    provider: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InitServerResult {
    ok: bool,
    message: String,
    id: String,
    file: String,
    directory: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepairMserveJsonPayload {
    directory: String,
    file: String,
    ram: u32,
    storage_limit: u32,
    auto_backup: Vec<String>,
    auto_backup_interval: u32,
    auto_restart: bool,
    custom_flags: Vec<String>,
    java_installation: Option<String>,
    provider: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncedMserveConfig {
    id: String,
    file: String,
    ram: u32,
    storage_limit: u32,
    auto_backup: Vec<String>,
    auto_backup_interval: u32,
    auto_restart: bool,
    custom_flags: Vec<String>,
    java_installation: Option<String>,
    provider: Option<String>,
    version: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncMserveJsonResult {
    status: String,
    message: String,
    config: Option<SyncedMserveConfig>,
    updated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToggleItemPayload {
    directory: String,
    item_type: String,
    file: String,
    activate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItemActionPayload {
    directory: String,
    item_type: String,
    file: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreBackupPayload {
    directory: String,
    backup_directory: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateServerSettingsPayload {
    directory: String,
    ram: u32,
    storage_limit: Option<u32>,
    auto_backup: Vec<String>,
    auto_backup_interval: u32,
    auto_restart: bool,
    custom_flags: Vec<String>,
    java_installation: Option<String>,
    jar_swap_path: Option<String>,
    new_directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateServerSettingsResult {
    directory: String,
    file: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadItemPayload {
    directory: String,
    item_type: String,
    source_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportWorldResult {
    path: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct RuntimeServerConfig {
    file: String,
    ram: Option<u32>,
    storage_limit: Option<u32>,
    custom_flags: Option<Vec<String>>,
    java_installation: Option<String>,
    provider: Option<String>,
}

struct RunningServerProcess {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
struct RuntimeState {
    processes: Mutex<HashMap<String, RunningServerProcess>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerOutputEvent {
    directory: String,
    stream: String,
    line: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatusResult {
    running: bool,
    exit_code: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PathValidationResult {
    exists: bool,
    is_directory: bool,
    is_file: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadServerJarPayload {
    url: String,
    preferred_file_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadServerJarResult {
    path: String,
    file_name: String,
    size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerDirectoryInspectionResult {
    kind: String,
    exists: bool,
    is_directory: bool,
    is_empty: bool,
    has_mserve_json: bool,
    has_server_properties: bool,
    has_eula_txt: bool,
    first_jar_file: Option<String>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannedPlugin {
    name: Option<String>,
    file: String,
    url: Option<String>,
    size: Option<u64>,
    activated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannedWorld {
    name: Option<String>,
    file: String,
    size: Option<u64>,
    activated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannedDatapack {
    name: Option<String>,
    file: String,
    activated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerScanResult {
    plugins: Vec<ScannedPlugin>,
    worlds: Vec<ScannedWorld>,
    datapacks: Vec<ScannedDatapack>,
    backups: Vec<ScannedBackup>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannedBackup {
    directory: String,
    created_at: String,
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            forward_port_windows_firewall,
            validate_path,
            get_local_ip,
            get_system_memory_gb,
            download_server_jar,
            initialize_server,
            inspect_server_directory,
            import_server,
            sync_server_mserve_json,
            repair_server_mserve_json,
            open_server_folder,
            open_server_path,
            delete_server_item,
            uninstall_server_item,
            export_server_world,
            create_server_backup,
            update_server_settings,
            restore_server_backup,
            delete_server_backup,
            upload_server_item,
            start_server,
            get_server_start_command,
            stop_server,
            force_kill_server,
            send_server_command,
            get_server_runtime_status,
            scan_server_contents,
            set_server_item_active,
            delete_server
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
