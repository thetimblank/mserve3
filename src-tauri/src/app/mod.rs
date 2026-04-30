mod commands;
mod support;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Child, ChildStdin};
use std::sync::Mutex;
use tauri::Manager;

use commands::*;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MserveProvider {
    name: String,
    file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    download_url: Option<String>,
    provider_version: String,
    minecraft_version: String,
    jdk_versions: Vec<u32>,
    supported_telemetry: Vec<String>,
    stable: bool,
}

#[derive(Debug, Deserialize)]
struct InitServerPayload {
    directory: String,
    create_directory_if_missing: bool,
    file: String,
    ram: u32,
    storage_limit: u32,
    auto_restart: bool,
    auto_backup: Vec<String>,
    auto_backup_interval: u32,
    auto_agree_eula: bool,
    java_installation: Option<String>,
    provider: Option<MserveProvider>,
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
    provider: Option<MserveProvider>,
    telemetry_host: Option<String>,
    telemetry_port: Option<u16>,
}

#[derive(Debug, Serialize, Clone)]
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
    provider: MserveProvider,
    telemetry_host: String,
    telemetry_port: u16,
    created_at: String,
}

#[derive(Debug, Serialize)]
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
struct UpdateServerSettingsPayload {
    directory: String,
    ram: u32,
    storage_limit: u32,
    auto_backup: Vec<String>,
    auto_backup_interval: u32,
    auto_restart: bool,
    custom_flags: Vec<String>,
    java_installation: Option<String>,
    provider: MserveProvider,
    telemetry_host: Option<String>,
    telemetry_port: Option<u16>,
    jar_swap_path: Option<String>,
    new_directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateServerSettingsResult {
    directory: String,
    file: String,
    provider: MserveProvider,
    telemetry_host: String,
    telemetry_port: u16,
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
    provider: Option<MserveProvider>,
    telemetry_host: Option<String>,
    telemetry_port: Option<u16>,
}

struct RunningServerProcess {
    child: Child,
    stdin: ChildStdin,
    pid: u32,
    started_at: chrono::DateTime<chrono::Utc>,
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
struct ServerTelemetryResult {
    online: bool,
    players_online: Option<u32>,
    players_max: Option<u32>,
    server_version: Option<String>,
    provider_version: Option<String>,
    tps: Option<f64>,
    ram_used: Option<f64>,
    cpu_used: Option<f64>,
    uptime: Option<String>,
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
    download_id: Option<String>,
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
struct JavaRuntimeInfo {
    executable_path: String,
    major_version: u32,
    version: String,
    vendor: String,
    source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JavaRuntimeDetectionResult {
    runtimes: Vec<JavaRuntimeInfo>,
    errors: Vec<String>,
    scanned_candidates: usize,
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
    worlds_size_bytes: u64,
    backups_size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannedBackup {
    directory: String,
    created_at: String,
    size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateBackupResult {
    backup: ScannedBackup,
    deleted_backups_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreBackupResult {
    deleted_backups_count: usize,
}

#[tauri::command]
fn complete_startup(app: tauri::AppHandle) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }

    if let Some(splash_window) = app.get_webview_window("splashscreen") {
        let _ = splash_window.close();
    }
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                std::thread::sleep(std::time::Duration::from_secs(8));

                if let Some(main_window) = app_handle.get_webview_window("main") {
                    let _ = main_window.show();
                    let _ = main_window.set_focus();
                }

                if let Some(splash_window) = app_handle.get_webview_window("splashscreen") {
                    let _ = splash_window.close();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            forward_port_windows_firewall,
            validate_path,
            get_local_ip,
            get_system_memory_gb,
            detect_java_runtimes,
            download_server_jar,
            initialize_server,
            inspect_server_directory,
            import_server,
            sync_server_mserve_json,
            repair_server_mserve_json,
            scan_managed_server_config_files,
            read_managed_server_config_file,
            write_managed_server_config_file,
            get_default_servers_root_path,
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
            get_server_telemetry,
            scan_server_contents,
            set_server_item_active,
            delete_server,
            complete_startup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
