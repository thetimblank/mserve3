use super::super::support::extract_zip_to_directory;
use super::super::{JavaRuntimeInfo, inspect_java_executable, managed_java_root};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Emitter;

const JAVA_DOWNLOAD_PROGRESS_EVENT: &str = "java-download-progress";

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct JavaDownloadProgressEvent {
    major_version: u32,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    progress: f64,
    done: bool,
}

/// Adoptium only ships zip archives for Windows. The other platforms use
/// `.tar.gz`, which we don't unpack here — callers fall back to the Java guide.
fn adoptium_os() -> Option<&'static str> {
    #[cfg(target_os = "windows")]
    {
        Some("windows")
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

fn adoptium_arch() -> Option<&'static str> {
    match std::env::consts::ARCH {
        "x86_64" => Some("x64"),
        "aarch64" => Some("aarch64"),
        _ => None,
    }
}

fn find_java_executable(root: &Path, depth: u32) -> Option<PathBuf> {
    let direct = root.join("bin").join("java.exe");
    if direct.is_file() {
        return Some(direct);
    }

    if depth == 0 {
        return None;
    }

    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir()
            && let Some(found) = find_java_executable(&path, depth - 1)
        {
            return Some(found);
        }
    }

    None
}

/// Downloads the latest GA Eclipse Temurin JRE for `major_version` from the
/// Adoptium API, extracts it into the app-managed Java directory, and returns
/// the resolved runtime so it can be used immediately. Streams progress via the
/// `java-download-progress` event (same shape as the jar download flow).
#[tauri::command]
pub(in crate::app) fn download_java_runtime(
    app: tauri::AppHandle,
    major_version: u32,
) -> Result<JavaRuntimeInfo, String> {
    let os = adoptium_os().ok_or_else(|| {
        "Automatic Java download isn't supported on this platform yet. Use the Java guide to install Java manually.".to_string()
    })?;
    let arch = adoptium_arch().ok_or_else(|| {
        "Automatic Java download isn't supported on this CPU architecture yet. Use the Java guide to install Java manually.".to_string()
    })?;

    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/{major_version}/ga/{os}/{arch}/jre/hotspot/normal/eclipse"
    );

    let managed_root = managed_java_root(&app).ok_or_else(|| {
        "Could not resolve the app data directory for Java downloads.".to_string()
    })?;
    let install_dir = managed_root.join(format!("temurin-{major_version}"));

    let download_dir = std::env::temp_dir().join("mserve").join("java-downloads");
    fs::create_dir_all(&download_dir).map_err(|err| err.to_string())?;
    let archive_path = download_dir.join(format!("temurin-{major_version}.zip"));

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|err| err.to_string())?;

    let mut response = client.get(&url).send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Adoptium download failed with HTTP status {} for Java {major_version}.",
            response.status().as_u16()
        ));
    }

    let total_bytes = response.content_length();
    let mut downloaded_bytes: u64 = 0;
    let mut archive_file = fs::File::create(&archive_path).map_err(|err| err.to_string())?;

    let emit_progress = |downloaded: u64, done: bool| {
        let progress = match total_bytes {
            Some(0) | None => {
                if done {
                    1.0
                } else {
                    0.0
                }
            }
            Some(total) => (downloaded as f64 / total as f64).clamp(0.0, 1.0),
        };

        let _ = app.emit(
            JAVA_DOWNLOAD_PROGRESS_EVENT,
            JavaDownloadProgressEvent {
                major_version,
                downloaded_bytes: downloaded,
                total_bytes,
                progress,
                done,
            },
        );
    };

    emit_progress(0, false);

    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = response.read(&mut buffer).map_err(|err| err.to_string())?;
        if read == 0 {
            break;
        }

        archive_file
            .write_all(&buffer[..read])
            .map_err(|err| err.to_string())?;

        downloaded_bytes = downloaded_bytes.saturating_add(read as u64);
        emit_progress(downloaded_bytes, false);
    }

    archive_file.flush().map_err(|err| err.to_string())?;

    if downloaded_bytes == 0 {
        return Err("Downloaded Java archive was empty.".to_string());
    }

    // Replace any previous install of this major so re-downloads stay clean.
    if install_dir.exists() {
        let _ = fs::remove_dir_all(&install_dir);
    }
    fs::create_dir_all(&install_dir).map_err(|err| err.to_string())?;

    extract_zip_to_directory(&archive_path, &install_dir)?;
    let _ = fs::remove_file(&archive_path);

    let executable = find_java_executable(&install_dir, 3).ok_or_else(|| {
        "Java was downloaded but the java executable could not be located in the archive."
            .to_string()
    })?;

    emit_progress(downloaded_bytes, true);

    inspect_java_executable(&executable, "managed")
}
