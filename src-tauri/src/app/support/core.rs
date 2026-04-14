use super::super::*;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub(in crate::app) fn home_dir() -> PathBuf {
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home);
    }
    if let Some(user_profile) = env::var_os("USERPROFILE") {
        return PathBuf::from(user_profile);
    }
    PathBuf::from("")
}

pub(in crate::app) fn move_file_with_fallback(src: &Path, dest: &Path) -> Result<(), String> {
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

pub(in crate::app) fn copy_jar_to_server_directory(directory: &Path, jar_path: &str) -> Result<(String, String), String> {
    let jar_path = jar_path.trim();
    
    if jar_path.is_empty() {
        return Err("Server jar file path is required.".to_string());
    }

    let source_path = PathBuf::from(jar_path);
    
    // Validate the source file exists
    if !source_path.exists() {
        return Err(format!("Server jar file not found: {}", jar_path));
    }
    
    if !source_path.is_file() {
        return Err(format!("Path is not a file: {}", jar_path));
    }
    
    // Validate it's a jar file
    if !jar_path.to_lowercase().ends_with(".jar") {
        return Err("Server file must be a .jar file.".to_string());
    }
    
    // Get the filename from the source path
    let filename = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid jar filename.".to_string())?
        .to_string();
    
    let destination = directory.join(&filename);
    
    // Check if destination already exists
    if destination.exists() {
        return Ok((
            filename.clone(),
            format!("Server jar file '{}' already exists in the server directory.", filename),
        ));
    }
    
    // Copy the file to the server directory
    fs::copy(&source_path, &destination).map_err(|err| {
        format!("Failed to copy jar file to server directory: {}", err)
    })?;
    
    Ok((
        filename.clone(),
        format!("Copied '{}' to server directory.", filename),
    ))
}

pub(in crate::app) fn write_eula(directory: &Path) -> Result<(), String> {
    let content = [
        "#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).",
        "eula=true",
        "",
    ]
    .join("\n");

    fs::write(directory.join("eula.txt"), content).map_err(|err| err.to_string())
}

pub(in crate::app) fn server_key(directory: &str) -> String {
    directory.trim().replace('\\', "/").to_lowercase()
}

pub(in crate::app) fn get_runtime_config(directory: &Path) -> Result<RuntimeServerConfig, String> {
    let mserve_path = directory.join("mserve.json");
    if !mserve_path.exists() {
        return Err("mserve.json not found in server directory.".to_string());
    }

    let data = fs::read_to_string(&mserve_path).map_err(|err| err.to_string())?;
    let parsed: RuntimeServerConfig = serde_json::from_str(&data).map_err(|err| err.to_string())?;

    Ok(parsed)
}

pub(in crate::app) fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
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
