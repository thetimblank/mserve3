use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, State};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InitServerPayload {
    directory: String,
    create_directory_if_missing: bool,
    file: String,
    ram: u32,
    auto_restart: bool,
    auto_backup: Vec<String>,
    auto_backup_interval: u32,
    auto_agree_eula: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InitServerResult {
    ok: bool,
    message: String,
    file: String,
    directory: String,
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
    custom_flags: Option<Vec<String>>,
    explicit_info_names: Option<bool>,
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
}

fn home_dir() -> PathBuf {
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home);
    }
    if let Some(user_profile) = env::var_os("USERPROFILE") {
        return PathBuf::from(user_profile);
    }
    PathBuf::from("")
}

fn move_file_with_fallback(src: &Path, dest: &Path) -> Result<(), String> {
    if src == dest {
        return Ok(());
    }

    if let Err(rename_err) = fs::rename(src, dest) {
        fs::copy(src, dest)
            .map_err(|copy_err| format!("rename: {rename_err}; copy: {copy_err}"))?;
        fs::remove_file(src).ok();
    }

    Ok(())
}

fn maybe_auto_move_jar(directory: &Path, preferred_file: &str) -> (String, String) {
    let preferred = preferred_file.trim();
    let filename = if preferred.is_empty() {
        "server.jar"
    } else {
        preferred
    };

    let home = home_dir();

    let mut names = vec![filename.to_string()];
    if !filename.eq_ignore_ascii_case("server.jar") {
        names.push("server.jar".to_string());
    }

    for name in names {
        let candidates = vec![
            env::current_dir().ok().map(|cwd| cwd.join(&name)),
            Some(home.join("Downloads").join(&name)),
            Some(home.join("downloads").join(&name)),
            Some(home.join("Desktop").join(&name)),
            Some(home.join(&name)),
        ];

        let destination = directory.join(&name);

        for candidate in candidates.into_iter().flatten() {
            if !candidate.exists() {
                continue;
            }

            if destination.exists() {
                return (
                    name.clone(),
                    format!("Couldn't auto-move {name}: destination already contains this file."),
                );
            }

            if move_file_with_fallback(&candidate, &destination).is_ok() {
                return (
                    name.clone(),
                    format!(
                        "Auto-moved {name} from {} to {}.",
                        candidate.display(),
                        directory.display()
                    ),
                );
            }
        }
    }

    (
        filename.to_string(),
        format!(
            "Couldn't auto-move {}. Please place the file manually in: {}",
            filename,
            directory.display()
        ),
    )
}

fn write_eula(directory: &Path) -> Result<(), String> {
    let content = [
        "#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).",
        "eula=true",
        "",
    ]
    .join("\n");

    fs::write(directory.join("eula.txt"), content).map_err(|err| err.to_string())
}

fn server_key(directory: &str) -> String {
    directory.trim().replace('\\', "/").to_lowercase()
}

fn get_runtime_config(directory: &Path) -> Result<RuntimeServerConfig, String> {
    let mserve_path = directory.join("mserve.json");
    if !mserve_path.exists() {
        return Err("mserve.json not found in server directory.".to_string());
    }

    let data = fs::read_to_string(&mserve_path).map_err(|err| err.to_string())?;
    let parsed: RuntimeServerConfig = serde_json::from_str(&data).map_err(|err| err.to_string())?;

    Ok(parsed)
}

fn to_alpha_prefix(value: &str) -> Option<String> {
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

fn infer_plugin_name(file_name: &str, explicit: bool) -> Option<String> {
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

fn infer_datapack_name(file_name: &str, explicit: bool) -> Option<String> {
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

fn path_size_bytes(path: &Path) -> u64 {
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

fn list_plugins(directory: &Path, explicit: bool) -> Vec<ScannedPlugin> {
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

fn list_worlds(directory: &Path) -> Vec<ScannedWorld> {
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

fn list_datapacks(directory: &Path, explicit: bool) -> Vec<ScannedDatapack> {
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

fn emit_output_reader<R: std::io::Read + Send + 'static>(
    reader: R,
    directory: String,
    stream: &'static str,
    app: tauri::AppHandle,
) {
    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines().flatten() {
            let _ = app.emit(
                "server-output",
                ServerOutputEvent {
                    directory: directory.clone(),
                    stream: stream.to_string(),
                    line,
                },
            );
        }
    });
}

fn drain_reader<R: std::io::Read + Send + 'static>(reader: R) {
    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for _ in buffered.lines() {}
    });
}

fn stop_child_process(process: &mut RunningServerProcess) -> Result<(), String> {
    let _ = writeln!(process.stdin, "stop");
    let _ = process.stdin.flush();

    for _ in 0..25 {
        match process.child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(err) => return Err(err.to_string()),
        }
    }

    process.child.kill().map_err(|err| err.to_string())?;
    process.child.wait().map_err(|err| err.to_string())?;
    Ok(())
}

fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let normalized = path
            .canonicalize()
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy()
            .replace('/', "\\");

        Command::new("explorer")
            .arg(normalized)
            .spawn()
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform.".to_string())
}

fn is_simple_relative_name(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.contains("..")
}

fn item_roots(directory: &Path, item_type: &str) -> Result<(PathBuf, PathBuf), String> {
    let inactive_root = directory.join("inactive");
    match item_type {
        "plugin" => Ok((directory.join("plugins"), inactive_root.join("plugins"))),
        "world" => Ok((directory.to_path_buf(), inactive_root.join("worlds"))),
        "datapack" => Ok((directory.join("world").join("datapacks"), inactive_root.join("datapacks"))),
        _ => Err("Unsupported item type.".to_string()),
    }
}

fn resolve_item_locations(directory: &Path, item_type: &str, file: &str) -> Result<(PathBuf, PathBuf), String> {
    let (active_parent, inactive_parent) = item_roots(directory, item_type)?;
    Ok((active_parent.join(file), inactive_parent.join(file)))
}

fn remove_item_to_trash(payload: &ItemActionPayload) -> Result<(), String> {
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

fn add_path_to_zip<W: Write + io::Seek>(
    writer: &mut zip::ZipWriter<W>,
    root: &Path,
    path: &Path,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|err| err.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    if relative.is_empty() {
        return Ok(());
    }

    if path.is_dir() {
        writer
            .add_directory(format!("{relative}/"), options)
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    writer
        .start_file(relative, options)
        .map_err(|err| err.to_string())?;
    let mut file = fs::File::open(path).map_err(|err| err.to_string())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).map_err(|err| err.to_string())?;
    writer.write_all(&buffer).map_err(|err| err.to_string())?;
    Ok(())
}

fn toggle_item_activation(payload: ToggleItemPayload) -> Result<(), String> {
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

#[tauri::command]
fn initialize_server(payload: InitServerPayload) -> Result<InitServerResult, String> {
    let directory_str = payload.directory.trim();
    if directory_str.is_empty() {
        return Ok(InitServerResult {
            ok: false,
            message: "Server directory is required.".to_string(),
            file: payload.file,
            directory: payload.directory,
        });
    }

    let directory = PathBuf::from(directory_str);

    if !directory.exists() {
        if !payload.create_directory_if_missing {
            return Ok(InitServerResult {
                ok: false,
                message: "Directory does not exist. Enable 'Create directory if it doesn't exist' or choose another path.".to_string(),
                file: payload.file,
                directory: directory_str.to_string(),
            });
        }

        fs::create_dir_all(&directory).map_err(|err| err.to_string())?;
    }

    if directory.join("mserve.json").exists() || directory.join("server.properties").exists() {
        return Ok(InitServerResult {
            ok: false,
            message: "There is already a server in this location.".to_string(),
            file: payload.file,
            directory: directory_str.to_string(),
        });
    }

    let auto_backup: Vec<String> = payload
        .auto_backup
        .into_iter()
        .filter(|value| matches!(value.as_str(), "interval" | "on_close" | "on_start"))
        .collect();

    let mut content = json!({
        "explicit_info_names": false,
        "auto_backup": auto_backup,
        "ram": payload.ram.max(1),
        "directory": directory_str,
        "file": payload.file.trim(),
        "auto_backup_interval": payload.auto_backup_interval.max(1),
        "auto_restart": payload.auto_restart,
        "createdAt": chrono::Local::now().to_rfc3339(),
    });

    let (resolved_file, move_message) = maybe_auto_move_jar(&directory, payload.file.trim());
    content["file"] = serde_json::Value::String(resolved_file.clone());

    let mserve_file = directory.join("mserve.json");
    fs::write(mserve_file, serde_json::to_vec_pretty(&content).map_err(|err| err.to_string())?)
        .map_err(|err| err.to_string())?;

    if payload.auto_agree_eula {
        write_eula(&directory)?;
    }

    Ok(InitServerResult {
        ok: true,
        message: format!("Initialization complete. {move_message}"),
        file: resolved_file,
        directory: directory_str.to_string(),
    })
}

#[tauri::command]
fn open_server_folder(directory: String) -> Result<(), String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    open_path_in_file_manager(&directory_path)
}

#[tauri::command]
fn open_server_path(path: String) -> Result<(), String> {
    let raw = path.trim();
    let target = PathBuf::from(raw.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !target.exists() {
        return Err("Target path does not exist.".to_string());
    }

    let open_target = if target.is_dir() {
        target
    } else {
        target
            .parent()
            .map(|parent| parent.to_path_buf())
            .ok_or_else(|| "Cannot resolve parent directory.".to_string())?
    };

    open_path_in_file_manager(&open_target)
}

#[tauri::command]
fn delete_server_item(payload: ItemActionPayload) -> Result<(), String> {
    remove_item_to_trash(&payload)
}

#[tauri::command]
fn uninstall_server_item(payload: ItemActionPayload) -> Result<(), String> {
    if payload.item_type != "plugin" {
        return Err("Uninstall is only supported for plugins.".to_string());
    }

    remove_item_to_trash(&payload)
}

#[tauri::command]
fn export_server_world(payload: ItemActionPayload) -> Result<ExportWorldResult, String> {
    if payload.item_type != "world" {
        return Err("Export is only supported for worlds.".to_string());
    }

    let directory = PathBuf::from(payload.directory.trim());
    if !directory.exists() || !directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let file = payload.file.trim();
    if !is_simple_relative_name(file) {
        return Err("Invalid world path.".to_string());
    }

    let (active_path, inactive_path) = resolve_item_locations(&directory, "world", file)?;
    let world_path = if active_path.exists() {
        active_path
    } else if inactive_path.exists() {
        inactive_path
    } else {
        return Err("World folder not found.".to_string());
    };

    if !world_path.is_dir() {
        return Err("World export expects a directory.".to_string());
    }

    let downloads = home_dir().join("Downloads");
    fs::create_dir_all(&downloads).map_err(|err| err.to_string())?;

    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let zip_path = downloads.join(format!("{}-{}.zip", file, timestamp));
    let zip_file = fs::File::create(&zip_path).map_err(|err| err.to_string())?;
    let mut zip = zip::ZipWriter::new(zip_file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    for entry in WalkDir::new(&world_path).into_iter().flatten() {
        add_path_to_zip(&mut zip, &world_path, entry.path(), options)?;
    }

    zip.finish().map_err(|err| err.to_string())?;

    Ok(ExportWorldResult {
        path: zip_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn start_server(
    directory: String,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let config = get_runtime_config(&directory_path)?;
    let file = if config.file.trim().is_empty() {
        "server.jar".to_string()
    } else {
        config.file.trim().to_string()
    };

    let key = server_key(&directory);
    {
        let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
        let mut should_remove_stale = false;

        if let Some(existing) = processes.get_mut(&key) {
            match existing.child.try_wait() {
                Ok(None) => return Err("Server is already running.".to_string()),
                _ => should_remove_stale = true,
            }
        }

        if should_remove_stale {
            processes.remove(&key);
        }
    }

    let default_flags = vec!["--nogui".to_string()];
    let custom_flags = config.custom_flags.unwrap_or(default_flags);

    let mut args = vec![
        format!("-Xms{}G", config.ram.unwrap_or(3).max(1)),
        format!("-Xmx{}G", config.ram.unwrap_or(3).max(1)),
        "-jar".to_string(),
        file,
    ];
    args.extend(custom_flags);

    let mut child = Command::new("java")
        .args(args)
        .current_dir(&directory_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start java process: {err}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open server stdin.".to_string())?;

    if let Some(stdout) = child.stdout.take() {
        emit_output_reader(stdout, directory.clone(), "stdout", app.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        drain_reader(stderr);
    }

    let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
    processes.insert(key, RunningServerProcess { child, stdin });

    Ok("Server started.".to_string())
}

#[tauri::command]
fn stop_server(directory: String, state: State<'_, RuntimeState>) -> Result<String, String> {
    let key = server_key(&directory);
    let mut process = {
        let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
        processes
            .remove(&key)
            .ok_or_else(|| "Server is not running.".to_string())?
    };

    stop_child_process(&mut process)?;
    Ok("Server stopped.".to_string())
}

#[tauri::command]
fn send_server_command(
    directory: String,
    command: String,
    state: State<'_, RuntimeState>,
) -> Result<(), String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let normalized = trimmed.trim_start_matches('/');

    let key = server_key(&directory);
    let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
    let process = processes
        .get_mut(&key)
        .ok_or_else(|| "Server is not running.".to_string())?;

    if process.child.try_wait().map_err(|err| err.to_string())?.is_some() {
        processes.remove(&key);
        return Err("Server is not running.".to_string());
    }

    writeln!(process.stdin, "{normalized}").map_err(|err| err.to_string())?;
    process.stdin.flush().map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_server_runtime_status(
    directory: String,
    state: State<'_, RuntimeState>,
) -> Result<RuntimeStatusResult, String> {
    let key = server_key(&directory);
    let mut processes = state.processes.lock().map_err(|_| "Runtime lock failed.")?;

    let Some(process) = processes.get_mut(&key) else {
        return Ok(RuntimeStatusResult {
            running: false,
            exit_code: None,
        });
    };

    match process.child.try_wait().map_err(|err| err.to_string())? {
        None => Ok(RuntimeStatusResult {
            running: true,
            exit_code: None,
        }),
        Some(status) => {
            let code = status.code();
            processes.remove(&key);
            Ok(RuntimeStatusResult {
                running: false,
                exit_code: code,
            })
        }
    }
}

#[tauri::command]
fn scan_server_contents(directory: String) -> Result<ServerScanResult, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let config = get_runtime_config(&directory_path).unwrap_or_default();
    let explicit = config.explicit_info_names.unwrap_or(false);

    Ok(ServerScanResult {
        plugins: list_plugins(&directory_path, explicit),
        worlds: list_worlds(&directory_path),
        datapacks: list_datapacks(&directory_path, explicit),
    })
}

#[tauri::command]
fn set_server_item_active(payload: ToggleItemPayload) -> Result<(), String> {
    toggle_item_activation(payload)
}

#[tauri::command]
fn delete_server(directory: String, state: State<'_, RuntimeState>) -> Result<String, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() {
        return Err("Server directory does not exist.".to_string());
    }

    let key = server_key(&directory);
    if let Some(mut process) = state
        .processes
        .lock()
        .map_err(|_| "Runtime lock failed.")?
        .remove(&key)
    {
        stop_child_process(&mut process)?;
    }

    trash::delete(&directory_path).map_err(|err| err.to_string())?;
    Ok("Server moved to recycle bin.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            initialize_server,
            open_server_folder,
            open_server_path,
            delete_server_item,
            uninstall_server_item,
            export_server_world,
            start_server,
            stop_server,
            send_server_command,
            get_server_runtime_status,
            scan_server_contents,
            set_server_item_active,
            delete_server
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
