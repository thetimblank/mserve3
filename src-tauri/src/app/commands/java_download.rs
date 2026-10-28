#[cfg(unix)]
use super::super::support::extract_tar_gz_to_directory;
#[cfg(windows)]
use super::super::support::extract_zip_to_directory;
use super::super::support::{Checksum, download_to_file, http_client, scratch_dir};
use super::super::{
    JavaRuntimeInfo, inspect_java_executable, java_executable_name, managed_java_root,
};
use super::providers::fetch_text;
use super::run_blocking;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

/// Java majors with a download in flight; a second request for the same major
/// would race on the archive and the staging directory.
static DOWNLOADING: Mutex<BTreeSet<u32>> = Mutex::new(BTreeSet::new());

struct DownloadClaim(u32);

impl DownloadClaim {
    fn take(major_version: u32) -> Result<Self, String> {
        let mut downloading = DOWNLOADING
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !downloading.insert(major_version) {
            return Err(format!("Java {major_version} is already being downloaded."));
        }
        Ok(Self(major_version))
    }
}

impl Drop for DownloadClaim {
    fn drop(&mut self) {
        DOWNLOADING
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.0);
    }
}

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

/// Adoptium OS identifier. Windows ships zip archives; Linux/macOS ship
/// `.tar.gz` — both are unpacked below.
fn adoptium_os() -> Option<&'static str> {
    match std::env::consts::OS {
        "windows" => Some("windows"),
        "linux" => Some("linux"),
        "macos" => Some("mac"),
        _ => None,
    }
}

const fn adoptium_archive_extension() -> &'static str {
    if cfg!(windows) { "zip" } else { "tar.gz" }
}

fn extract_java_archive(archive_path: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        extract_zip_to_directory(archive_path, destination)
    }
    #[cfg(unix)]
    {
        extract_tar_gz_to_directory(archive_path, destination)
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = (archive_path, destination);
        Err("Java archive extraction is not supported on this platform.".to_string())
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
    let direct = root.join("bin").join(java_executable_name());
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

/// One entry of Adoptium's `/v3/assets/latest` response (only what we use).
#[derive(serde::Deserialize)]
struct AdoptiumAsset {
    binary: AdoptiumBinary,
}

#[derive(serde::Deserialize)]
struct AdoptiumBinary {
    package: AdoptiumPackage,
}

#[derive(serde::Deserialize)]
struct AdoptiumPackage {
    link: String,
    checksum: String,
}

/// Resolves the latest GA Temurin JRE package (download link + sha256).
fn resolve_adoptium_package(
    client: &reqwest::blocking::Client,
    major_version: u32,
    os: &str,
    arch: &str,
) -> Result<AdoptiumPackage, String> {
    let url = format!(
        "https://api.adoptium.net/v3/assets/latest/{major_version}/hotspot?architecture={arch}&image_type=jre&os={os}&vendor=eclipse"
    );
    let text = fetch_text(client, &url)?;
    let assets: Vec<AdoptiumAsset> = serde_json::from_str(&text).map_err(|err| err.to_string())?;
    assets
        .into_iter()
        .map(|asset| asset.binary.package)
        .find(|package| package.link.ends_with(adoptium_archive_extension()))
        .ok_or_else(|| format!("Adoptium has no Java {major_version} runtime for this system."))
}

/// Downloads the latest GA Eclipse Temurin JRE for `major_version` from the
/// Adoptium API, verifies its sha256, extracts it into the app-managed Java
/// directory, and returns the resolved runtime so it can be used immediately.
/// Streams progress via the `java-download-progress` event (same shape as the
/// jar download flow).
#[tauri::command]
pub(in crate::app) async fn download_java_runtime(
    app: tauri::AppHandle,
    major_version: u32,
) -> Result<JavaRuntimeInfo, String> {
    run_blocking(move || download_java_runtime_blocking(&app, major_version)).await
}

fn download_java_runtime_blocking(
    app: &tauri::AppHandle,
    major_version: u32,
) -> Result<JavaRuntimeInfo, String> {
    let os = adoptium_os().ok_or_else(|| {
        "Automatic Java download isn't supported on this platform yet. Use the Java guide to install Java manually.".to_string()
    })?;
    let arch = adoptium_arch().ok_or_else(|| {
        "Automatic Java download isn't supported on this CPU architecture yet. Use the Java guide to install Java manually.".to_string()
    })?;

    let _claim = DownloadClaim::take(major_version)?;

    let managed_root = managed_java_root(app).ok_or_else(|| {
        "Could not resolve the app data directory for Java downloads.".to_string()
    })?;
    let install_dir = managed_root.join(format!("temurin-{major_version}"));

    let client = http_client(Duration::from_secs(600))?;
    let package = resolve_adoptium_package(&client, major_version, os, arch)?;

    let archive_path = scratch_dir("java-downloads")?.join(format!(
        "temurin-{major_version}.{}",
        adoptium_archive_extension()
    ));

    let emit_progress = |downloaded: u64, total_bytes: Option<u64>, done: bool| {
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

    emit_progress(0, None, false);

    let mut total_bytes = None;
    let checksum = Checksum::Sha256(package.checksum);
    let downloaded_bytes = download_to_file(
        &client,
        &package.link,
        &archive_path,
        Some(&checksum),
        |downloaded, total| {
            total_bytes = total;
            emit_progress(downloaded, total, false);
        },
    )
    .map_err(|err| format!("Java {major_version} download failed: {err}"))?;

    // Extract next to the install, then swap it in, so a failure (or a runtime
    // that's in use and locked) never leaves a half-deleted install behind.
    let staging_dir = managed_root.join(format!(".temurin-{major_version}.staging"));
    let _ = fs::remove_dir_all(&staging_dir);
    let extracted = fs::create_dir_all(&staging_dir)
        .map_err(|err| err.to_string())
        .and_then(|()| extract_java_archive(&archive_path, &staging_dir));
    let _ = fs::remove_file(&archive_path);
    if let Err(err) = extracted {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(err);
    }

    if let Err(err) = replace_install_dir(&staging_dir, &install_dir) {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(err);
    }

    let executable = find_java_executable(&install_dir, 3).ok_or_else(|| {
        "Java was downloaded but the java executable could not be located in the archive."
            .to_string()
    })?;

    emit_progress(downloaded_bytes, total_bytes, true);

    inspect_java_executable(&executable, "managed")
}

/// Moves a freshly extracted runtime into `install_dir`. An existing install is
/// renamed aside first (and restored if the swap fails); renaming fails cleanly
/// when a running server still has files in it open on Windows.
fn replace_install_dir(staging_dir: &Path, install_dir: &Path) -> Result<(), String> {
    if !install_dir.exists() {
        return fs::rename(staging_dir, install_dir).map_err(|err| err.to_string());
    }

    let retired = install_dir.with_extension("old");
    let _ = fs::remove_dir_all(&retired);
    fs::rename(install_dir, &retired).map_err(|err| {
        format!("The existing Java install is in use (stop servers using it first): {err}")
    })?;
    if let Err(err) = fs::rename(staging_dir, install_dir) {
        let _ = fs::rename(&retired, install_dir);
        return Err(err.to_string());
    }
    let _ = fs::remove_dir_all(&retired);
    Ok(())
}
