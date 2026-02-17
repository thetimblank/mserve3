use serde::{Deserialize, Serialize};
use serde_json::json;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

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
                    format!("Auto-moved {name} from {} to {}.", candidate.display(), directory.display()),
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![initialize_server])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
