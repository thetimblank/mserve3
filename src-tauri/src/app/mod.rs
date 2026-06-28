mod commands;
mod support;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::process::{Child, ChildStdin};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{Emitter, Manager};

use commands::{
    __cmd__create_server_backup, __cmd__delete_server, __cmd__delete_server_backup,
    __cmd__delete_server_item, __cmd__detect_java_runtimes, __cmd__download_java_runtime,
    __cmd__download_server_jar, __cmd__export_server_world, __cmd__force_kill_all_servers,
    __cmd__force_kill_server, __cmd__forward_port_windows_firewall,
    __cmd__get_default_servers_root_path, __cmd__get_local_ip, __cmd__get_public_ip,
    __cmd__get_running_server_directories, __cmd__get_server_runtime,
    __cmd__get_server_start_command, __cmd__get_server_telemetry,
    __cmd__get_server_telemetry_history, __cmd__get_system_memory_gb, __cmd__import_server,
    __cmd__initialize_server, __cmd__inspect_server_directory, __cmd__list_provider_versions,
    __cmd__open_server_folder, __cmd__open_server_path, __cmd__read_managed_server_config_file,
    __cmd__read_networks_config, __cmd__read_server_network_file, __cmd__repair_server_mserve_json,
    __cmd__resolve_provider_version, __cmd__restart_server, __cmd__restore_server_backup,
    __cmd__run_in_background, __cmd__scan_managed_server_config_files, __cmd__scan_server_contents,
    __cmd__send_server_command, __cmd__set_server_item_active, __cmd__set_server_java_installation,
    __cmd__start_server, __cmd__stop_server, __cmd__sync_server_mserve_json,
    __cmd__uninstall_server_item, __cmd__update_server_backup_settings,
    __cmd__update_server_settings, __cmd__upload_server_item, __cmd__validate_path,
    __cmd__write_managed_server_config_file, __cmd__write_networks_config,
    __cmd__write_server_network_file, __tauri_command_name_create_server_backup,
    __tauri_command_name_delete_server, __tauri_command_name_delete_server_backup,
    __tauri_command_name_delete_server_item, __tauri_command_name_detect_java_runtimes,
    __tauri_command_name_download_java_runtime, __tauri_command_name_download_server_jar,
    __tauri_command_name_export_server_world, __tauri_command_name_force_kill_all_servers,
    __tauri_command_name_force_kill_server, __tauri_command_name_forward_port_windows_firewall,
    __tauri_command_name_get_default_servers_root_path, __tauri_command_name_get_local_ip,
    __tauri_command_name_get_public_ip, __tauri_command_name_get_running_server_directories,
    __tauri_command_name_get_server_runtime, __tauri_command_name_get_server_start_command,
    __tauri_command_name_get_server_telemetry, __tauri_command_name_get_server_telemetry_history,
    __tauri_command_name_get_system_memory_gb, __tauri_command_name_import_server,
    __tauri_command_name_initialize_server, __tauri_command_name_inspect_server_directory,
    __tauri_command_name_list_provider_versions, __tauri_command_name_open_server_folder,
    __tauri_command_name_open_server_path, __tauri_command_name_read_managed_server_config_file,
    __tauri_command_name_read_networks_config, __tauri_command_name_read_server_network_file,
    __tauri_command_name_repair_server_mserve_json, __tauri_command_name_resolve_provider_version,
    __tauri_command_name_restart_server, __tauri_command_name_restore_server_backup,
    __tauri_command_name_run_in_background, __tauri_command_name_scan_managed_server_config_files,
    __tauri_command_name_scan_server_contents, __tauri_command_name_send_server_command,
    __tauri_command_name_set_server_item_active, __tauri_command_name_set_server_java_installation,
    __tauri_command_name_start_server, __tauri_command_name_stop_server,
    __tauri_command_name_sync_server_mserve_json, __tauri_command_name_uninstall_server_item,
    __tauri_command_name_update_server_backup_settings,
    __tauri_command_name_update_server_settings, __tauri_command_name_upload_server_item,
    __tauri_command_name_validate_path, __tauri_command_name_write_managed_server_config_file,
    __tauri_command_name_write_networks_config, __tauri_command_name_write_server_network_file,
    create_server_backup, delete_server, delete_server_backup, delete_server_item,
    detect_java_runtimes, download_java_runtime, download_server_jar, export_server_world,
    force_kill_all_servers, force_kill_server, forward_port_windows_firewall,
    get_default_servers_root_path, get_local_ip, get_public_ip, get_running_server_directories,
    get_server_runtime, get_server_start_command, get_server_telemetry,
    get_server_telemetry_history, get_system_memory_gb, import_server, initialize_server,
    inspect_java_executable, inspect_server_directory, list_provider_versions, managed_java_root,
    open_server_folder, open_server_path, read_managed_server_config_file, read_networks_config,
    read_server_network_file, repair_server_mserve_json, resolve_provider_version, restart_server,
    restore_server_backup, run_in_background, scan_managed_server_config_files,
    scan_server_contents, send_server_command, set_server_item_active,
    set_server_java_installation, start_server, stop_server, sync_server_mserve_json,
    uninstall_server_item, update_server_backup_settings, update_server_settings,
    upload_server_item, validate_path, write_managed_server_config_file, write_networks_config,
    write_server_network_file,
};

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
    /// The actual port the server is bound to. Set on the `starting` event so
    /// the frontend can update its view immediately (e.g. when we reassigned a
    /// conflicting port before spawn).
    server_port: Option<u16>,
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
fn confirm_close(_app: tauri::AppHandle) {
    // std::process::exit avoids the "Failed to unregister class Chrome_WidgetWin_0"
    // error that occurs when Tauri's webview cleanup races with window destruction.
    std::process::exit(0);
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

/// Directories of every server that isn't fully stopped — used to warn the user
/// before a real quit.
fn running_server_directories(app: &tauri::AppHandle) -> Vec<String> {
    let state: tauri::State<'_, RuntimeState> = app.state();
    let guard = state
        .processes
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    guard
        .values()
        .filter(|r| !matches!(r.state, LifecycleState::Offline | LifecycleState::Crashed))
        .map(|r| r.directory.clone())
        .collect()
}

/// Emit `app-close-requested` so the frontend can prompt before shutdown. The
/// frontend confirms via `confirm_close` (or force-kills first if servers run).
fn emit_close_requested(app: &tauri::AppHandle) {
    let _ = app.emit(
        "app-close-requested",
        AppCloseRequestedPayload {
            running_server_directories: running_server_directories(app),
        },
    );
}

/// Window-event handler: on a main-window close request, veto the OS close and
/// route through the frontend close flow (warn about running servers).
///
/// Extracted from the builder chain so it compiles as its own symbol rather than
/// being inlined into the (otherwise enormous) `run` closure.
fn on_main_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == "main"
        && let tauri::WindowEvent::CloseRequested { api, .. } = event
    {
        api.prevent_close();
        emit_close_requested(window.app_handle());
    }
}

/// Bring the UI back from background mode. If the main window still exists just
/// show + focus it; otherwise rebuild it (the webview was destroyed by
/// `run_in_background`). Mirrors the `main` window config in `tauri.conf.json`;
/// the window-state plugin restores the last size/position.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let _ =
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            .title("MSERVE")
            .decorations(false)
            .inner_size(1200.0, 800.0)
            .build();
}

/// Tray "Quit" handler. If the UI is open, route through the normal close flow so
/// the running-servers warning can intervene. If we're backgrounded (no window to
/// host the dialog), force-kill servers and exit directly.
fn quit_app(app: &tauri::AppHandle) {
    if app.get_webview_window("main").is_some() {
        emit_close_requested(app);
        show_main_window(app);
        return;
    }

    let state: tauri::State<'_, RuntimeState> = app.state();
    let _ = force_kill_all_servers(state);
    // Give the OS a moment to actually terminate the processes before exit.
    std::thread::sleep(std::time::Duration::from_millis(500));
    std::process::exit(0);
}

/// Build the system tray icon shown while the app runs in the background (and
/// always, so the user can summon the window or quit). Left-clicking the icon —
/// or the "Open MSERVE" menu item — restores the UI; "Quit MSERVE" exits.
fn setup_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let open_item = MenuItemBuilder::with_id("open", "Open MSERVE").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit MSERVE").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&open_item, &quit_item])
        .build()?;

    let mut tray_builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("MSERVE")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }

    tray_builder.build(app)?;
    Ok(())
}

/// One-time app setup: open the telemetry store and schedule the splash → main
/// window handoff. Extracted from the builder chain for the same reason as
/// [`on_main_window_event`].
fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Open the telemetry time-series database in the app data dir.
    if let Ok(data_dir) = app.path().app_data_dir()
        && let Err(err) = support::init_telemetry_store(&data_dir.join("telemetry.db"))
    {
        eprintln!("[Telemetry] Failed to open store: {err}");
    }

    if let Err(err) = setup_tray(app.handle()) {
        eprintln!("[Tray] Failed to create tray icon: {err}");
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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeState::default())
        .on_window_event(on_main_window_event)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION,
                )
                .build(),
        )
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            forward_port_windows_firewall,
            validate_path,
            get_local_ip,
            get_public_ip,
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
            update_server_backup_settings,
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
            run_in_background,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            // When the main window is destroyed for background mode, the last
            // window closing would normally end the app. Veto that exit so the
            // Rust process (and every running server) stays alive behind the tray
            // icon. A real quit goes through `confirm_close` / the tray "Quit"
            // item, which call `std::process::exit` and bypass this guard.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}
