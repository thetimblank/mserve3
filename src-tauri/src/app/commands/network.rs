use super::super::support::*;
use super::super::*;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Emitter;

const JAR_DOWNLOAD_PROGRESS_EVENT: &str = "server-jar-download-progress";

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadServerJarProgressEvent {
    download_id: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    progress: f64,
    done: bool,
}

fn sanitize_file_name(input: &str) -> String {
    let mut sanitized: String = input
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
        .collect();

    if sanitized.is_empty() {
        sanitized = "server.jar".to_string();
    }

    if !sanitized.to_lowercase().ends_with(".jar") {
        sanitized.push_str(".jar");
    }

    sanitized
}

fn infer_file_name_from_url(url: &str) -> Option<String> {
    url.split('/')
        .next_back()
        .and_then(|segment| segment.split('?').next())
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(ToOwned::to_owned)
}

fn unique_destination_path(base_directory: &Path, file_name: &str) -> PathBuf {
    let mut candidate = base_directory.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let file_path = Path::new(file_name);
    let stem = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("server");
    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("jar");

    for index in 1..=9999 {
        let next_name = format!("{stem}-{index}.{extension}");
        candidate = base_directory.join(next_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    base_directory.join(format!("{stem}-{timestamp}.{extension}"))
}

fn system_memory_bytes() -> Result<u64, String> {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory",
            ])
            .output()
            .map_err(|err| format!("Failed to query system memory: {err}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let details = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                "Unknown error while reading system memory.".to_string()
            };
            return Err(details);
        }

        let raw = String::from_utf8_lossy(&output.stdout);
        let bytes = raw
            .split_whitespace()
            .next()
            .ok_or_else(|| "System memory output was empty.".to_string())?
            .parse::<u64>()
            .map_err(|err| format!("Failed to parse system memory bytes: {err}"))?;

        return Ok(bytes);
    }

    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .map_err(|err| format!("Failed to query system memory: {err}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "Failed to query system memory.".to_string()
            } else {
                stderr
            });
        }

        let bytes = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u64>()
            .map_err(|err| format!("Failed to parse system memory bytes: {err}"))?;

        return Ok(bytes);
    }

    #[cfg(target_os = "linux")]
    {
        let meminfo = std::fs::read_to_string("/proc/meminfo")
            .map_err(|err| format!("Failed to read /proc/meminfo: {err}"))?;

        let mem_total_kb = meminfo
            .lines()
            .find(|line| line.starts_with("MemTotal:"))
            .and_then(|line| line.split_whitespace().nth(1))
            .ok_or_else(|| "MemTotal could not be found in /proc/meminfo.".to_string())?
            .parse::<u64>()
            .map_err(|err| format!("Failed to parse MemTotal value: {err}"))?;

        return Ok(mem_total_kb.saturating_mul(1024));
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("System memory command is not supported on this platform.".to_string())
    }
}

#[tauri::command]
pub(in crate::app) fn get_system_memory_gb() -> Result<u32, String> {
    let bytes = system_memory_bytes()?;
    let gib = ((bytes as f64) / (1024_f64 * 1024_f64 * 1024_f64)).ceil() as u32;
    Ok(gib.max(1))
}

#[tauri::command]
pub(in crate::app) fn forward_port_windows_firewall(port: u16) -> Result<Vec<String>, String> {
    if port == 0 {
        return Err("Port must be between 1 and 65535.".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = port;
        return Err("Windows Defender Firewall forwarding is only supported on Windows.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !is_windows_admin()? {
            return forward_port_windows_firewall_elevated(port);
        }

        let mut created = Vec::with_capacity(4);
        for protocol in ["TCP", "UDP"] {
            for direction in ["in", "out"] {
                created.push(add_windows_firewall_rule(port, protocol, direction)?);
            }
        }
        Ok(created)
    }
}

#[tauri::command]
pub(in crate::app) fn validate_path(path: String) -> Result<PathValidationResult, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(PathValidationResult {
            exists: false,
            is_directory: false,
            is_file: false,
        });
    }

    let candidate = PathBuf::from(trimmed);
    Ok(PathValidationResult {
        exists: candidate.exists(),
        is_directory: candidate.is_dir(),
        is_file: candidate.is_file(),
    })
}

#[tauri::command]
pub(in crate::app) fn get_local_ip() -> Result<String, String> {
    resolve_local_ip().ok_or_else(|| "Unable to determine local IP address.".to_string())
}

#[tauri::command]
pub(in crate::app) fn download_server_jar(
    app: tauri::AppHandle,
    payload: DownloadServerJarPayload,
) -> Result<DownloadServerJarResult, String> {
    let url = payload.url.trim();
    if url.is_empty() {
        return Err("Download URL is required.".to_string());
    }

    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only HTTP(S) URLs are supported for jar downloads.".to_string());
    }

    let provided_name = payload.preferred_file_name.unwrap_or_default();
    let suggested_name = if provided_name.trim().is_empty() {
        infer_file_name_from_url(url).unwrap_or_else(|| "server.jar".to_string())
    } else {
        provided_name
    };
    let file_name = sanitize_file_name(&suggested_name);

    let download_id = payload
        .download_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            let millis = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_millis())
                .unwrap_or(0);
            format!("jar-download-{millis}")
        });

    let destination_dir = std::env::temp_dir().join("mserve").join("jar-downloads");
    fs::create_dir_all(&destination_dir).map_err(|err| err.to_string())?;

    let destination_path = unique_destination_path(&destination_dir, &file_name);
    let temp_path = destination_path.with_extension("jar.part");

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|err| err.to_string())?;

    let mut response = client.get(url).send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Download failed with HTTP status {}.",
            response.status().as_u16()
        ));
    }

    let total_bytes = response.content_length();
    let mut downloaded_bytes: u64 = 0;
    let mut temp_file = fs::File::create(&temp_path).map_err(|err| err.to_string())?;

    let emit_progress = |downloaded: u64, done: bool| {
        let progress = if let Some(total) = total_bytes {
            if total == 0 {
                if done { 1.0 } else { 0.0 }
            } else {
                (downloaded as f64 / total as f64).clamp(0.0, 1.0)
            }
        } else if done {
            1.0
        } else {
            0.0
        };

        let payload = DownloadServerJarProgressEvent {
            download_id: download_id.clone(),
            downloaded_bytes: downloaded,
            total_bytes,
            progress,
            done,
        };

        let _ = app.emit(JAR_DOWNLOAD_PROGRESS_EVENT, payload);
    };

    emit_progress(0, false);

    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = response.read(&mut buffer).map_err(|err| err.to_string())?;
        if read == 0 {
            break;
        }

        temp_file
            .write_all(&buffer[..read])
            .map_err(|err| err.to_string())?;

        downloaded_bytes = downloaded_bytes.saturating_add(read as u64);
        emit_progress(downloaded_bytes, false);
    }

    temp_file.flush().map_err(|err| err.to_string())?;

    if downloaded_bytes == 0 {
        return Err("Downloaded file was empty.".to_string());
    }

    move_file_with_fallback(&temp_path, &destination_path)?;

    emit_progress(downloaded_bytes, true);

    let final_path = destination_path
        .canonicalize()
        .unwrap_or_else(|_| destination_path.clone());
    let resolved_file_name = final_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("server.jar")
        .to_string();

    Ok(DownloadServerJarResult {
        path: final_path.to_string_lossy().to_string(),
        file_name: resolved_file_name,
        size_bytes: downloaded_bytes,
    })
}

