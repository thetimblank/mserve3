#[cfg(target_os = "linux")]
use super::super::support::forward_port_linux_firewall;
use super::super::support::{
    Checksum, download_to_file, http_client, move_file_with_fallback, resolve_local_ip,
    resolve_public_ip, scratch_dir,
};
#[cfg(target_os = "windows")]
use super::super::support::{
    add_windows_firewall_rule, forward_port_windows_firewall_elevated, is_windows_admin,
};
use super::super::{DownloadServerJarPayload, DownloadServerJarResult, PathValidationResult};
use super::run_blocking;
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
        .map_or(0, |value| value.as_millis());
    base_directory.join(format!("{stem}-{timestamp}.{extension}"))
}

#[tauri::command]
pub(in crate::app) fn get_system_memory_gb() -> Result<u32, String> {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    let bytes = system.total_memory();
    if bytes == 0 {
        return Err("Failed to query system memory.".to_string());
    }
    let gib = ((bytes as f64) / (1024_f64 * 1024_f64 * 1024_f64)).ceil() as u32;
    Ok(gib.max(1))
}

/// Opens `port` (TCP + UDP) in the local firewall: Windows Defender Firewall on
/// Windows, firewalld/ufw on Linux. Elevates when needed (UAC / polkit), which
/// blocks until the user answers the prompt.
#[tauri::command]
pub(in crate::app) async fn forward_port_firewall(port: u16) -> Result<Vec<String>, String> {
    run_blocking(move || forward_port_firewall_blocking(port)).await
}

fn forward_port_firewall_blocking(port: u16) -> Result<Vec<String>, String> {
    if port == 0 {
        return Err("Port must be between 1 and 65535.".to_string());
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

    #[cfg(target_os = "linux")]
    {
        forward_port_linux_firewall(port)
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = port;
        Err("Automatic firewall configuration is not supported on this platform.".to_string())
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
pub(in crate::app) async fn get_public_ip() -> Result<String, String> {
    run_blocking(|| {
        resolve_public_ip().ok_or_else(|| {
            "Unable to determine public IP address. Check your internet connection.".to_string()
        })
    })
    .await
}

#[tauri::command]
pub(in crate::app) async fn download_server_jar(
    app: tauri::AppHandle,
    payload: DownloadServerJarPayload,
) -> Result<DownloadServerJarResult, String> {
    run_blocking(move || download_server_jar_blocking(&app, payload)).await
}

fn download_server_jar_blocking(
    app: &tauri::AppHandle,
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
                .map_or(0, |value| value.as_millis());
            format!("jar-download-{millis}")
        });

    // Prefer the strongest hash the provider published.
    let checksum = Checksum::from_hex(Checksum::Sha256, payload.sha256.as_deref())
        .or_else(|| Checksum::from_hex(Checksum::Sha1, payload.sha1.as_deref()));

    let destination_dir = scratch_dir("jar-downloads")?;
    let destination_path = unique_destination_path(&destination_dir, &file_name);
    let temp_path = destination_path.with_extension("jar.part");

    let client = http_client(Duration::from_secs(180))?;

    let emit_progress = |downloaded: u64, total_bytes: Option<u64>, done: bool| {
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

    emit_progress(0, None, false);

    let mut total_bytes = None;
    let downloaded_bytes = download_to_file(
        &client,
        url,
        &temp_path,
        checksum.as_ref(),
        |downloaded, total| {
            total_bytes = total;
            emit_progress(downloaded, total, false);
        },
    )?;

    if let Err(err) = move_file_with_fallback(&temp_path, &destination_path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(err);
    }

    emit_progress(downloaded_bytes, total_bytes, true);

    let final_path =
        dunce::canonicalize(&destination_path).unwrap_or_else(|_| destination_path.clone());
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
