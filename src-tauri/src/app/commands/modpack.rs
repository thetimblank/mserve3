use super::super::support::no_window_command;
use super::providers::fetch_cached;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

const MODPACK_PROGRESS_EVENT: &str = "modpack-install-progress";
const FABRIC_META: &str = "https://meta.fabricmc.net/v2";
const NEOFORGE_MAVEN: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge";
const FORGE_MAVEN: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const MAX_DOWNLOAD_WORKERS: usize = 8;

/// Hosts the Modrinth modpack spec allows pack files to be downloaded from.
const ALLOWED_MRPACK_HOSTS: [&str; 4] = [
    "cdn.modrinth.com",
    "github.com",
    "raw.githubusercontent.com",
    "gitlab.com",
];

// ---------------------------------------------------------------------------
// Boundary structs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::app) struct InstallModpackPayload {
    /// Target server directory; must not exist yet (or be an empty directory).
    directory: String,
    /// Download URL of the .mrpack file (Modrinth CDN).
    url: String,
    #[serde(default)]
    sha512: Option<String>,
    /// Java executable used to run the Forge/NeoForge installer when needed.
    #[serde(default)]
    java_executable: Option<String>,
    /// Correlates `modpack-install-progress` events.
    #[serde(default)]
    install_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::app) struct InstallModpackResult {
    directory: String,
    minecraft_version: String,
    /// "fabric" | "forge" | "neoforge"
    provider_name: String,
    loader_version: String,
    /// The launch jar relative to the directory. For Forge/NeoForge argfile
    /// launches this is a placeholder — the runtime resolves the argfile itself.
    file: String,
    jdk_versions: Vec<u32>,
    pack_name: String,
    pack_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModpackProgressEvent {
    install_id: String,
    /// "downloading-pack" | "extracting" | "downloading-files" | "installing-loader" | "done"
    stage: String,
    message: String,
    files_done: usize,
    files_total: usize,
    progress: f64,
    done: bool,
}

// ---------------------------------------------------------------------------
// mrpack index (modrinth.index.json)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MrpackIndex {
    format_version: u32,
    #[allow(dead_code)]
    game: String,
    version_id: String,
    name: String,
    #[serde(default)]
    files: Vec<MrpackFile>,
    dependencies: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MrpackFile {
    path: String,
    #[serde(default)]
    hashes: MrpackHashes,
    #[serde(default)]
    env: Option<MrpackEnv>,
    downloads: Vec<String>,
    #[serde(default)]
    #[allow(dead_code)]
    file_size: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
struct MrpackHashes {
    #[serde(default)]
    sha512: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MrpackEnv {
    #[serde(default)]
    server: Option<String>,
}

fn mrpack_file_is_for_server(file: &MrpackFile) -> bool {
    file.env
        .as_ref()
        .and_then(|env| env.server.as_deref())
        .map(|value| !value.eq_ignore_ascii_case("unsupported"))
        .unwrap_or(true)
}

/// Validates a pack-relative path: purely relative, no parent/root components.
fn safe_relative_path(raw: &str) -> Option<PathBuf> {
    let normalized = raw.replace('\\', "/");
    let path = PathBuf::from(&normalized);
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                // Reject Windows drive-letter segments (e.g. "C:") even when
                // running on a platform whose `Path` parser doesn't treat
                // them as a `Prefix` component (Linux), since archives are
                // portable across the Windows/Linux hosts mserve supports.
                if part.to_str().map_or(true, |s| s.contains(':')) {
                    return None;
                }
                clean.push(part);
            }
            Component::CurDir => {}
            _ => return None,
        }
    }
    if clean.as_os_str().is_empty() {
        None
    } else {
        Some(clean)
    }
}

fn is_allowed_mrpack_host(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|parsed| {
        parsed.scheme() == "https"
            && parsed.host_str().is_some_and(|host| {
                ALLOWED_MRPACK_HOSTS
                    .iter()
                    .any(|allowed| host.eq_ignore_ascii_case(allowed))
            })
    })
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

fn modpack_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .user_agent(concat!(
            "mserve/",
            env!("CARGO_PKG_VERSION"),
            " (github.com/thetimblank/mserve3)"
        ))
        .build()
        .map_err(|err| err.to_string())
}

/// Streams `url` into `destination`, returning the byte count and sha512 hex.
fn download_to_file(
    client: &reqwest::blocking::Client,
    url: &str,
    destination: &Path,
    mut on_chunk: impl FnMut(u64, Option<u64>),
) -> Result<(u64, String), String> {
    let mut response = client.get(url).send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Download of {url} failed with HTTP status {}.",
            response.status().as_u16()
        ));
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let total = response.content_length();
    let mut file = fs::File::create(destination).map_err(|err| err.to_string())?;
    let mut hasher = Sha512::new();
    let mut downloaded: u64 = 0;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = response.read(&mut buffer).map_err(|err| err.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        file.write_all(&buffer[..read])
            .map_err(|err| err.to_string())?;
        downloaded = downloaded.saturating_add(read as u64);
        on_chunk(downloaded, total);
    }
    file.flush().map_err(|err| err.to_string())?;

    Ok((downloaded, format!("{:x}", hasher.finalize())))
}

fn verify_sha512(expected: Option<&str>, actual: &str, what: &str) -> Result<(), String> {
    if let Some(expected) = expected.map(str::trim).filter(|value| !value.is_empty())
        && !actual.eq_ignore_ascii_case(expected)
    {
        return Err(format!("{what} failed integrity verification."));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Loader installation
// ---------------------------------------------------------------------------

struct LoaderInstall {
    provider_name: String,
    loader_version: String,
    /// Launch file relative to the server directory.
    file: String,
}

fn install_fabric_loader(
    client: &reqwest::blocking::Client,
    directory: &Path,
    minecraft_version: &str,
    loader_version: &str,
) -> Result<LoaderInstall, String> {
    #[derive(Deserialize)]
    struct InstallerVersion {
        version: String,
        stable: bool,
    }

    let installers_text = fetch_cached(
        client,
        &format!("{FABRIC_META}/versions/installer"),
        "fabric-installer-versions.json",
        60 * 60,
    )?;
    let installers: Vec<InstallerVersion> =
        serde_json::from_str(&installers_text).map_err(|err| err.to_string())?;
    let installer = installers
        .iter()
        .find(|entry| entry.stable)
        .or_else(|| installers.first())
        .ok_or_else(|| "No Fabric installer version is available.".to_string())?;

    let file_name = format!("fabric-server-mc.{minecraft_version}-loader.{loader_version}.jar");
    let url = format!(
        "{FABRIC_META}/versions/loader/{minecraft_version}/{loader_version}/{}/server/jar",
        installer.version
    );
    let (bytes, _) = download_to_file(client, &url, &directory.join(&file_name), |_, _| {})?;
    if bytes == 0 {
        return Err("Downloaded Fabric server launcher was empty.".to_string());
    }

    Ok(LoaderInstall {
        provider_name: "fabric".to_string(),
        loader_version: loader_version.to_string(),
        file: file_name,
    })
}

/// Runs the Forge/NeoForge installer jar (`--installServer`) inside the server
/// directory, then removes the installer artifacts.
fn run_loader_installer(
    client: &reqwest::blocking::Client,
    directory: &Path,
    java_executable: Option<&str>,
    provider_name: &str,
    installer_url: &str,
    loader_version: &str,
) -> Result<LoaderInstall, String> {
    let java = java_executable
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "Installing a {provider_name} modpack requires a Java runtime. Install Java first (see the Java guide)."
            )
        })?;
    if !PathBuf::from(java).is_file() {
        return Err(format!("Java executable was not found at \"{java}\"."));
    }

    let installer_path = directory.join("mserve-loader-installer.jar");
    let (bytes, _) = download_to_file(client, installer_url, &installer_path, |_, _| {})?;
    if bytes == 0 {
        return Err(format!("Downloaded {provider_name} installer was empty."));
    }

    let output = no_window_command(java)
        .arg("-jar")
        .arg(&installer_path)
        .arg("--installServer")
        .arg(directory)
        .current_dir(directory)
        .output()
        .map_err(|err| format!("Failed to run the {provider_name} installer: {err}"))?;

    // Best-effort cleanup of installer artifacts regardless of outcome.
    let _ = fs::remove_file(&installer_path);
    let _ = fs::remove_file(directory.join("mserve-loader-installer.jar.log"));

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let tail: String = stdout
            .lines()
            .chain(stderr.lines())
            .rev()
            .take(5)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(format!("The {provider_name} installer failed: {tail}"));
    }

    Ok(LoaderInstall {
        provider_name: provider_name.to_string(),
        loader_version: loader_version.to_string(),
        file: resolve_post_install_launch_file(directory),
    })
}

/// After a Forge/NeoForge install: modern versions launch through an argfile
/// (the runtime probes for it), so the recorded jar is only a placeholder.
/// Legacy Forge (pre-1.17) leaves a launchable `forge-*.jar` in the root.
fn resolve_post_install_launch_file(directory: &Path) -> String {
    let argfile_roots = [
        directory
            .join("libraries")
            .join("net")
            .join("neoforged")
            .join("neoforge"),
        directory
            .join("libraries")
            .join("net")
            .join("minecraftforge")
            .join("forge"),
    ];
    for root in argfile_roots {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            if entry.path().join("win_args.txt").is_file()
                || entry.path().join("unix_args.txt").is_file()
            {
                return "server.jar".to_string();
            }
        }
    }

    if let Ok(entries) = fs::read_dir(directory) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let lowered = name.to_lowercase();
            if lowered.starts_with("forge-") && lowered.ends_with(".jar") {
                return name;
            }
        }
    }

    "server.jar".to_string()
}

fn install_loader(
    client: &reqwest::blocking::Client,
    directory: &Path,
    java_executable: Option<&str>,
    dependencies: &BTreeMap<String, String>,
    minecraft_version: &str,
) -> Result<LoaderInstall, String> {
    if let Some(loader_version) = dependencies.get("fabric-loader") {
        return install_fabric_loader(client, directory, minecraft_version, loader_version);
    }

    if let Some(loader_version) = dependencies.get("neoforge") {
        let url =
            format!("{NEOFORGE_MAVEN}/{loader_version}/neoforge-{loader_version}-installer.jar");
        return run_loader_installer(
            client,
            directory,
            java_executable,
            "neoforge",
            &url,
            loader_version,
        );
    }

    if let Some(loader_version) = dependencies.get("forge") {
        // Forge maven coordinates are "<minecraft>-<forge>".
        let coordinate = format!("{minecraft_version}-{loader_version}");
        let url = format!("{FORGE_MAVEN}/{coordinate}/forge-{coordinate}-installer.jar");
        return run_loader_installer(
            client,
            directory,
            java_executable,
            "forge",
            &url,
            loader_version,
        );
    }

    if dependencies.contains_key("quilt-loader") {
        return Err("Quilt modpacks are not supported yet.".to_string());
    }

    Err(
        "This modpack does not declare a supported mod loader (Fabric, Forge, or NeoForge)."
            .to_string(),
    )
}

// ---------------------------------------------------------------------------
// Pack content
// ---------------------------------------------------------------------------

/// Extracts a zip subtree (e.g. "overrides/") of the .mrpack into the server
/// directory, preserving relative structure and skipping unsafe paths.
fn extract_override_tree(
    archive: &mut zip::ZipArchive<fs::File>,
    prefix: &str,
    directory: &Path,
) -> Result<(), String> {
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|err| err.to_string())?;
        let name = entry.name().to_string();
        if !name.starts_with(prefix) {
            continue;
        }
        let relative = &name[prefix.len()..];
        if relative.is_empty() {
            continue;
        }
        let Some(safe) = safe_relative_path(relative) else {
            continue;
        };
        let destination = directory.join(safe);

        if entry.is_dir() {
            fs::create_dir_all(&destination).map_err(|err| err.to_string())?;
            continue;
        }

        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let mut file = fs::File::create(&destination).map_err(|err| err.to_string())?;
        std::io::copy(&mut entry, &mut file).map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// Downloads the pack's server files with a small worker pool, verifying each
/// sha512. Returns the first error encountered, if any.
fn download_pack_files(
    directory: &Path,
    files: Vec<MrpackFile>,
    emit: &(impl Fn(&str, &str, usize, usize, f64) + Sync),
) -> Result<(), String> {
    let total = files.len();
    if total == 0 {
        return Ok(());
    }

    let queue = Arc::new(Mutex::new(files));
    let errors: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let done = Arc::new(AtomicUsize::new(0));
    let worker_count = MAX_DOWNLOAD_WORKERS.min(total).max(1);

    std::thread::scope(|scope| {
        for _ in 0..worker_count {
            let queue = Arc::clone(&queue);
            let errors = Arc::clone(&errors);
            let done = Arc::clone(&done);
            scope.spawn(move || {
                let Ok(client) = modpack_client() else {
                    if let Ok(mut guard) = errors.lock() {
                        guard.push("Could not build a download client.".to_string());
                    }
                    return;
                };

                loop {
                    // Stop early once any worker has failed.
                    if errors.lock().map_or(true, |guard| !guard.is_empty()) {
                        break;
                    }
                    let next = {
                        let Ok(mut guard) = queue.lock() else { break };
                        guard.pop()
                    };
                    let Some(file) = next else { break };

                    let result = (|| -> Result<(), String> {
                        let relative = safe_relative_path(&file.path)
                            .ok_or_else(|| format!("Unsafe file path in modpack: {}", file.path))?;
                        let url = file
                            .downloads
                            .first()
                            .ok_or_else(|| format!("No download URL for {}", file.path))?;
                        if !is_allowed_mrpack_host(url) {
                            return Err(format!(
                                "Download host not allowed by the modpack spec: {url}"
                            ));
                        }
                        let destination = directory.join(&relative);
                        let (bytes, sha512) =
                            download_to_file(&client, url, &destination, |_, _| {})?;
                        if bytes == 0 {
                            return Err(format!("Downloaded file was empty: {}", file.path));
                        }
                        verify_sha512(file.hashes.sha512.as_deref(), &sha512, &file.path)
                    })();

                    match result {
                        Ok(()) => {
                            let finished = done.fetch_add(1, Ordering::SeqCst) + 1;
                            let progress = finished as f64 / total as f64;
                            emit(
                                "downloading-files",
                                &format!("Downloading mods ({finished}/{total})"),
                                finished,
                                total,
                                progress,
                            );
                        }
                        Err(err) => {
                            if let Ok(mut guard) = errors.lock() {
                                guard.push(err);
                            }
                        }
                    }
                }
            });
        }
    });

    let guard = errors.lock().map_err(|_| "Download state lock failed.")?;
    if let Some(first) = guard.first() {
        return Err(first.clone());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

#[tauri::command]
pub(in crate::app) fn install_modrinth_modpack(
    app: tauri::AppHandle,
    payload: InstallModpackPayload,
) -> Result<InstallModpackResult, String> {
    let directory = PathBuf::from(payload.directory.trim());
    if payload.directory.trim().is_empty() {
        return Err("Server directory is required.".to_string());
    }
    if directory.exists() {
        let is_empty_dir = directory.is_dir()
            && fs::read_dir(&directory)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false);
        if !is_empty_dir {
            return Err("The target directory already exists and is not empty.".to_string());
        }
    } else {
        fs::create_dir_all(&directory).map_err(|err| err.to_string())?;
    }

    if !is_allowed_mrpack_host(payload.url.trim()) {
        return Err("Modpacks can only be downloaded from the Modrinth CDN.".to_string());
    }

    let install_id = payload
        .install_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("modpack-install")
        .to_string();

    let emit =
        |stage: &str, message: &str, files_done: usize, files_total: usize, progress: f64| {
            let _ = app.emit(
                MODPACK_PROGRESS_EVENT,
                ModpackProgressEvent {
                    install_id: install_id.clone(),
                    stage: stage.to_string(),
                    message: message.to_string(),
                    files_done,
                    files_total,
                    progress: progress.clamp(0.0, 1.0),
                    done: stage == "done",
                },
            );
        };

    let client = modpack_client()?;

    // 1. Download the .mrpack itself.
    emit("downloading-pack", "Downloading modpack…", 0, 0, 0.0);
    let staging_dir = std::env::temp_dir()
        .join("mserve")
        .join("modpack-downloads");
    fs::create_dir_all(&staging_dir).map_err(|err| err.to_string())?;
    let mrpack_path = staging_dir.join(format!("{install_id}.mrpack"));
    let (bytes, pack_sha512) = download_to_file(
        &client,
        payload.url.trim(),
        &mrpack_path,
        |downloaded, total| {
            if let Some(total) = total.filter(|value| *value > 0) {
                emit(
                    "downloading-pack",
                    "Downloading modpack…",
                    0,
                    0,
                    downloaded as f64 / total as f64,
                );
            }
        },
    )?;
    if bytes == 0 {
        return Err("Downloaded modpack file was empty.".to_string());
    }
    verify_sha512(payload.sha512.as_deref(), &pack_sha512, "The modpack file")?;

    // 2. Parse the index.
    emit("extracting", "Reading modpack contents…", 0, 0, 0.0);
    let mrpack_file = fs::File::open(&mrpack_path).map_err(|err| err.to_string())?;
    let mut archive = zip::ZipArchive::new(mrpack_file).map_err(|err| err.to_string())?;
    let index: MrpackIndex = {
        let mut entry = archive.by_name("modrinth.index.json").map_err(|_| {
            "This file is not a valid Modrinth modpack (missing index).".to_string()
        })?;
        let mut text = String::new();
        entry
            .read_to_string(&mut text)
            .map_err(|err| err.to_string())?;
        serde_json::from_str(&text).map_err(|err| format!("Invalid modpack index: {err}"))?
    };

    if index.format_version != 1 {
        return Err(format!(
            "Unsupported modpack format version: {}.",
            index.format_version
        ));
    }

    let minecraft_version = index
        .dependencies
        .get("minecraft")
        .cloned()
        .ok_or_else(|| "The modpack does not declare a Minecraft version.".to_string())?;

    // 3. Download server-side files.
    let server_files: Vec<MrpackFile> = index
        .files
        .into_iter()
        .filter(mrpack_file_is_for_server)
        .collect();
    let files_total = server_files.len();
    emit(
        "downloading-files",
        &format!("Downloading mods (0/{files_total})"),
        0,
        files_total,
        0.0,
    );
    download_pack_files(&directory, server_files, &emit)?;

    // 4. Apply overrides (server-overrides win over shared overrides).
    emit("extracting", "Applying modpack overrides…", 0, 0, 0.0);
    extract_override_tree(&mut archive, "overrides/", &directory)?;
    extract_override_tree(&mut archive, "server-overrides/", &directory)?;

    // 5. Install the loader.
    emit("installing-loader", "Installing the mod loader…", 0, 0, 0.0);
    let loader = install_loader(
        &client,
        &directory,
        payload.java_executable.as_deref(),
        &index.dependencies,
        &minecraft_version,
    )?;

    let _ = fs::remove_file(&mrpack_path);

    // Best-effort Java requirement from Mojang's metadata for this MC version.
    let jdk_versions = super::providers::resolve_vanilla(&client, &minecraft_version)
        .map(|resolved| resolved.jdk_versions)
        .unwrap_or_default();

    emit("done", "Modpack installed.", files_total, files_total, 1.0);

    Ok(InstallModpackResult {
        directory: directory.to_string_lossy().to_string(),
        minecraft_version,
        provider_name: loader.provider_name,
        loader_version: loader.loader_version,
        file: loader.file,
        jdk_versions,
        pack_name: index.name,
        pack_version: index.version_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mrpack_index() {
        let json = r#"{
            "formatVersion": 1,
            "game": "minecraft",
            "versionId": "1.0.0",
            "name": "Example Pack",
            "files": [
                {
                    "path": "mods/example.jar",
                    "hashes": {"sha1": "a", "sha512": "b"},
                    "env": {"client": "required", "server": "required"},
                    "downloads": ["https://cdn.modrinth.com/data/x/versions/y/example.jar"],
                    "fileSize": 123
                },
                {
                    "path": "mods/client-only.jar",
                    "hashes": {"sha512": "c"},
                    "env": {"client": "required", "server": "unsupported"},
                    "downloads": ["https://cdn.modrinth.com/z.jar"]
                }
            ],
            "dependencies": {"minecraft": "1.21.1", "neoforge": "21.1.77"}
        }"#;
        let index: MrpackIndex = serde_json::from_str(json).unwrap();
        assert_eq!(index.format_version, 1);
        assert_eq!(index.name, "Example Pack");
        assert_eq!(index.files.len(), 2);
        assert!(mrpack_file_is_for_server(&index.files[0]));
        assert!(!mrpack_file_is_for_server(&index.files[1]));
        assert_eq!(index.dependencies["neoforge"], "21.1.77");
    }

    #[test]
    fn files_without_env_default_to_server_supported() {
        let json = r#"{
            "path": "mods/x.jar",
            "hashes": {},
            "downloads": ["https://cdn.modrinth.com/x.jar"]
        }"#;
        let file: MrpackFile = serde_json::from_str(json).unwrap();
        assert!(mrpack_file_is_for_server(&file));
    }

    #[test]
    fn rejects_unsafe_pack_paths() {
        assert!(safe_relative_path("mods/example.jar").is_some());
        assert!(safe_relative_path("config/nested/ok.toml").is_some());
        assert!(safe_relative_path("../escape.jar").is_none());
        assert!(safe_relative_path("mods/../../escape.jar").is_none());
        assert!(safe_relative_path("/absolute.jar").is_none());
        assert!(safe_relative_path("C:\\windows\\evil.jar").is_none());
        assert!(safe_relative_path("").is_none());
    }

    #[test]
    fn enforces_mrpack_host_allowlist() {
        assert!(is_allowed_mrpack_host(
            "https://cdn.modrinth.com/data/a/b.mrpack"
        ));
        assert!(is_allowed_mrpack_host(
            "https://github.com/x/y/releases/z.jar"
        ));
        assert!(!is_allowed_mrpack_host(
            "https://evil.example.com/pack.mrpack"
        ));
        assert!(!is_allowed_mrpack_host(
            "http://cdn.modrinth.com/insecure.jar"
        ));
    }

    #[test]
    fn sha512_verification_is_case_insensitive_and_optional() {
        assert!(verify_sha512(None, "abc", "x").is_ok());
        assert!(verify_sha512(Some(""), "abc", "x").is_ok());
        assert!(verify_sha512(Some("ABC"), "abc", "x").is_ok());
        assert!(verify_sha512(Some("def"), "abc", "x").is_err());
    }
}
