mod commands;
mod support;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::process::{Child, ChildStdin};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{Emitter, Manager};

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
    ram: f64,
    storage_limit: u32,
    auto_restart: bool,
    auto_backup: Vec<String>,
    auto_backup_interval: u32,
    auto_agree_eula: bool,
    java_installation: Option<String>,
    #[serde(default)]
    custom_flags: Option<Vec<String>>,
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
    ram: f64,
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
    ram: f64,
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
    ram: f64,
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
    id: Option<String>,
    file: String,
    ram: Option<f64>,
    storage_limit: Option<u32>,
    custom_flags: Option<Vec<String>>,
    java_installation: Option<String>,
    provider: Option<MserveProvider>,
    telemetry_host: Option<String>,
    telemetry_port: Option<u16>,
}

/// The authoritative lifecycle of a server, owned by the backend supervisor and
/// serialized to the frontend (kebab-case, e.g. "running-external").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum LifecycleState {
    Offline,
    Starting,
    Online,
    Stopping,
    Crashed,
    RunningExternal,
}

/// Loopback RCON credentials, provisioned into server.properties on start.
#[derive(Debug, Clone)]
struct RconConfig {
    port: u16,
    password: String,
}

/// Which TPS command this server understands, detected once and cached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TpsCommandState {
    Unknown,
    Paper,
    TickQuery,
    Unsupported,
}

/// A single timestamped telemetry reading. Returned live to the UI and appended
/// to the SQLite time-series store for the future timeline graph.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetrySample {
    /// Unix epoch milliseconds.
    timestamp: i64,
    online: bool,
    players_online: Option<u32>,
    players_max: Option<u32>,
    server_version: Option<String>,
    provider_version: Option<String>,
    tps: Option<f64>,
    /// Percent of the configured heap.
    ram_used: Option<f64>,
    /// Resident set size in bytes (for absolute graphs).
    ram_bytes: Option<u64>,
    /// Process CPU percent.
    cpu_used: Option<f64>,
    /// RFC3339 process start time.
    uptime: Option<String>,
}

/// A bucket-averaged history point from the telemetry store.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetryHistoryPoint {
    timestamp: i64,
    online: bool,
    players_online: Option<u32>,
    tps: Option<f64>,
    ram_bytes: Option<u64>,
    ram_used: Option<f64>,
    cpu_used: Option<f64>,
}

/// Everything the backend tracks for one server. `child`/`stdin`/`pid` are
/// `None` for adopted (externally-started) servers we only observe.
struct ServerRuntime {
    directory: String,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    pid: Option<u32>,
    started_at: chrono::DateTime<chrono::Utc>,
    state: LifecycleState,
    exit_code: Option<i32>,
    stderr_tail: VecDeque<String>,
    rcon: Option<RconConfig>,
    host: String,
    server_port: u16,
    is_proxy: bool,
    server_id: String,
    configured_ram: Option<f64>,
    provider_version: Option<String>,
    tps_state: TpsCommandState,
    latest_sample: Option<TelemetrySample>,
    generation: u64,
    stop_requested: bool,
    stop_requested_at: Option<Instant>,
}

#[derive(Default, Clone)]
struct RuntimeState {
    processes: Arc<Mutex<HashMap<String, ServerRuntime>>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerOutputEvent {
    directory: String,
    stream: String,
    line: String,
}

/// Emitted whenever a server's lifecycle state changes.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerRuntimeStateEvent {
    directory: String,
    state: LifecycleState,
    pid: Option<u32>,
    started_at: Option<String>,
    exit_code: Option<i32>,
    stderr_tail: Vec<String>,
}

/// Emitted on each telemetry sample for a running server.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerTelemetryEvent {
    directory: String,
    sample: TelemetrySample,
}

/// One-shot snapshot returned by `get_server_runtime` so a freshly-mounted UI
/// can render current state without waiting for the next event.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerRuntimeSnapshot {
    state: LifecycleState,
    pid: Option<u32>,
    started_at: Option<String>,
    exit_code: Option<i32>,
    stderr_tail: Vec<String>,
    sample: Option<TelemetrySample>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListProviderVersionsPayload {
    tab: String,
    #[serde(default)]
    include_unstable: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProviderVersionEntry {
    provider: String,
    tab: String,
    version: String,
    minecraft_version: String,
    /// "stable" | "unstable" | "release" | "snapshot"
    stability: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveProviderVersionPayload {
    provider: String,
    version: String,
    #[serde(default)]
    stability: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ResolvedProvider {
    name: String,
    file: String,
    download_url: String,
    provider_version: String,
    minecraft_version: String,
    jdk_versions: Vec<u32>,
    stable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha256: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JavaRuntimeInfo {
    executable_path: String,
    major_version: u32,
    version: String,
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppCloseRequestedPayload {
    running_server_directories: Vec<String>,
}

#[tauri::command]
fn confirm_close(app: tauri::AppHandle) {
    app.exit(0);
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
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let state: tauri::State<'_, RuntimeState> = window.state();
                    let running = {
                        let guard = state.processes.lock().unwrap_or_else(|e| e.into_inner());
                        guard
                            .values()
                            .filter(|r| {
                                !matches!(r.state, LifecycleState::Offline | LifecycleState::Crashed)
                            })
                            .map(|r| r.directory.clone())
                            .collect::<Vec<_>>()
                    };
                    let _ = window.app_handle().emit(
                        "app-close-requested",
                        AppCloseRequestedPayload {
                            running_server_directories: running,
                        },
                    );
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Open the telemetry time-series database in the app data dir.
            if let Ok(data_dir) = app.path().app_data_dir() {
                if let Err(err) = support::init_telemetry_store(&data_dir.join("telemetry.db")) {
                    eprintln!("[Telemetry] Failed to open store: {err}");
                }
            }

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
            download_java_runtime,
            download_server_jar,
            list_provider_versions,
            resolve_provider_version,
            initialize_server,
            inspect_server_directory,
            import_server,
            sync_server_mserve_json,
            repair_server_mserve_json,
            scan_managed_server_config_files,
            read_managed_server_config_file,
            write_managed_server_config_file,
            read_networks_config,
            write_networks_config,
            read_server_network_file,
            write_server_network_file,
            get_default_servers_root_path,
            open_server_folder,
            open_server_path,
            delete_server_item,
            uninstall_server_item,
            export_server_world,
            create_server_backup,
            update_server_settings,
            set_server_java_installation,
            restore_server_backup,
            delete_server_backup,
            upload_server_item,
            start_server,
            get_server_start_command,
            stop_server,
            restart_server,
            force_kill_server,
            force_kill_all_servers,
            get_running_server_directories,
            send_server_command,
            get_server_runtime,
            get_server_telemetry,
            get_server_telemetry_history,
            scan_server_contents,
            set_server_item_active,
            delete_server,
            complete_startup,
            confirm_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
