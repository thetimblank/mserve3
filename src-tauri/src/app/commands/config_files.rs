use super::super::support::apply_properties;
use super::super::{Deserialize, Serialize};
use super::run_blocking;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::ipc::Response;

const MANAGED_CONFIG_FILE_NAMES: [&str; 10] = [
    "server.properties",
    "ops.json",
    "whitelist.json",
    "banned-ips.json",
    "banned-players.json",
    "bukkit.yml",
    "help.yml",
    "commands.yml",
    "spigot.yml",
    "velocity.toml",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedConfigFileRequest {
    directory: String,
    file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedConfigFileWritePayload {
    directory: String,
    file_name: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedConfigFileStatus {
    file_name: String,
    exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedConfigFileContent {
    file_name: String,
    content: String,
}

fn normalize_managed_config_file_name(file_name: &str) -> Result<&'static str, String> {
    let normalized = file_name.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("Config file name is required.".to_string());
    }

    MANAGED_CONFIG_FILE_NAMES
        .iter()
        .copied()
        .find(|candidate| *candidate == normalized)
        .ok_or_else(|| format!("Unsupported config file: {file_name}"))
}

fn resolve_managed_config_file_path(
    directory: &str,
    file_name: &str,
) -> Result<(PathBuf, &'static str), String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let resolved_name = normalize_managed_config_file_name(file_name)?;
    Ok((directory_path.join(resolved_name), resolved_name))
}

#[tauri::command]
pub(in crate::app) fn scan_managed_server_config_files(
    directory: String,
) -> Result<Vec<ManagedConfigFileStatus>, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    Ok(MANAGED_CONFIG_FILE_NAMES
        .iter()
        .map(|file_name| ManagedConfigFileStatus {
            file_name: (*file_name).to_string(),
            exists: directory_path.join(file_name).exists(),
        })
        .collect())
}

#[tauri::command]
pub(in crate::app) fn read_managed_server_config_file(
    payload: ManagedConfigFileRequest,
) -> Result<ManagedConfigFileContent, String> {
    let (file_path, file_name) =
        resolve_managed_config_file_path(&payload.directory, &payload.file_name)?;
    let content = fs::read_to_string(&file_path).map_err(|err| err.to_string())?;

    Ok(ManagedConfigFileContent {
        file_name: file_name.to_string(),
        content,
    })
}

#[tauri::command]
pub(in crate::app) fn write_managed_server_config_file(
    payload: ManagedConfigFileWritePayload,
) -> Result<ManagedConfigFileContent, String> {
    let (file_path, file_name) =
        resolve_managed_config_file_path(&payload.directory, &payload.file_name)?;
    fs::write(&file_path, payload.content.as_bytes()).map_err(|err| err.to_string())?;

    Ok(ManagedConfigFileContent {
        file_name: file_name.to_string(),
        content: payload.content,
    })
}

/// Keys the security audit / featured-property editor is allowed to write via
/// `apply_server_properties`. Restricting the set keeps this targeted command
/// from becoming a general-purpose arbitrary-key writer.
const APPLY_ALLOWED_KEYS: [&str; 18] = [
    "online-mode",
    "white-list",
    "enforce-whitelist",
    "enforce-secure-profile",
    "rate-limit",
    "prevent-proxy-connections",
    "spawn-protection",
    "network-compression-threshold",
    "broadcast-rcon-to-ops",
    "hide-online-players",
    "max-players",
    "view-distance",
    "simulation-distance",
    "difficulty",
    "gamemode",
    "motd",
    "pvp",
    "allow-flight",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PropertyUpdate {
    key: String,
    value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplyServerPropertiesPayload {
    directory: String,
    updates: Vec<PropertyUpdate>,
}

/// Idempotently applies a set of `server.properties` key/value pairs, preserving
/// comments and ordering (unlike a whole-file rewrite). Only allow-listed keys
/// are accepted. Used by the security audit's one-click hardening fixes.
#[tauri::command]
pub(in crate::app) fn apply_server_properties(
    payload: ApplyServerPropertiesPayload,
) -> Result<(), String> {
    let directory_path = PathBuf::from(payload.directory.trim());
    if !directory_path.exists() || !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }
    if payload.updates.is_empty() {
        return Ok(());
    }

    let mut normalized: Vec<(&'static str, String)> = Vec::with_capacity(payload.updates.len());
    for update in &payload.updates {
        let key = update.key.trim().to_lowercase();
        let allowed = APPLY_ALLOWED_KEYS
            .iter()
            .copied()
            .find(|candidate| *candidate == key)
            .ok_or_else(|| format!("Property '{}' cannot be changed here.", update.key))?;
        normalized.push((allowed, update.value.trim().to_string()));
    }

    apply_properties(&directory_path, &normalized)
}

const SERVER_ICON_FILE_NAME: &str = "server-icon.png";
/// Minecraft only shows a `server-icon.png` that is exactly 64×64.
const SERVER_ICON_SIZE: u32 = 64;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
/// A 64×64 RGBA image is 16 KiB raw, so a real icon PNG is far below this.
const MAX_SERVER_ICON_BYTES: usize = 256 * 1024;

/// Width and height from a PNG's IHDR chunk, which must directly follow the
/// signature. `None` when the bytes aren't a PNG.
fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || bytes[..8] != PNG_SIGNATURE || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let read_u32 = |offset: usize| {
        bytes[offset..offset + 4]
            .try_into()
            .ok()
            .map(u32::from_be_bytes)
    };
    if read_u32(8)? != 13 {
        return None;
    }
    Some((read_u32(16)?, read_u32(20)?))
}

fn validate_server_icon(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_SERVER_ICON_BYTES {
        return Err("The server icon file is too large.".to_string());
    }
    match png_dimensions(bytes) {
        None => Err("The server icon must be a PNG image.".to_string()),
        Some((SERVER_ICON_SIZE, SERVER_ICON_SIZE)) => Ok(()),
        Some((width, height)) => Err(format!(
            "The server icon must be {SERVER_ICON_SIZE}×{SERVER_ICON_SIZE} pixels (got {width}×{height})."
        )),
    }
}

fn existing_server_directory(directory: &str) -> Result<PathBuf, String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }
    Ok(directory_path)
}

/// Writes `server-icon.png` (the icon shown in the multiplayer list). The
/// frontend crops and scales the picked image; this only accepts a 64×64 PNG.
/// The file is staged next to the target and renamed over the old icon, so a
/// failed write never leaves a half-written icon behind.
#[tauri::command]
pub(in crate::app) fn set_server_icon(directory: String, png_bytes: Vec<u8>) -> Result<(), String> {
    let directory_path = existing_server_directory(&directory)?;
    validate_server_icon(&png_bytes)?;

    let target = directory_path.join(SERVER_ICON_FILE_NAME);
    let staging = directory_path.join(format!("{SERVER_ICON_FILE_NAME}.tmp"));
    fs::write(&staging, &png_bytes)
        .map_err(|err| format!("Could not save the server icon: {err}"))?;
    fs::rename(&staging, &target).map_err(|err| {
        let _ = fs::remove_file(&staging);
        format!("Could not save the server icon: {err}")
    })
}

/// The current `server-icon.png` as a `data:image/png;base64,…` URL, or `None`
/// when the server has no icon (or the file isn't a PNG mserve can show).
#[tauri::command]
pub(in crate::app) fn get_server_icon(directory: String) -> Result<Option<String>, String> {
    use base64::Engine as _;

    let directory_path = existing_server_directory(&directory)?;
    let path = directory_path.join(SERVER_ICON_FILE_NAME);
    let Ok(metadata) = fs::metadata(&path) else {
        return Ok(None);
    };
    if !metadata.is_file() || metadata.len() > MAX_SERVER_ICON_BYTES as u64 {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    if png_dimensions(&bytes).is_none() {
        return Ok(None);
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(format!("data:image/png;base64,{encoded}")))
}

/// Image types the icon picker accepts; the webview decodes them.
const SERVER_ICON_SOURCE_EXTENSIONS: [&str; 7] =
    ["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico"];
/// Photos straight off a camera fit; anything bigger is not an icon source.
const MAX_SERVER_ICON_SOURCE_BYTES: u64 = 64 * 1024 * 1024;

fn validate_server_icon_source(path: &Path, size: u64) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !SERVER_ICON_SOURCE_EXTENSIONS.contains(&extension.as_str()) {
        return Err("Pick a PNG, JPG, WebP, GIF, BMP or ICO image.".to_string());
    }
    if size > MAX_SERVER_ICON_SOURCE_BYTES {
        return Err("This image is too large. Pick one under 64 MB.".to_string());
    }
    Ok(())
}

/// Reads an image the user picked or dropped for the server icon, so the
/// webview can crop and scale it (a native drop only hands the frontend a
/// path). Returned as raw bytes, which reach JS as an `ArrayBuffer` instead of
/// a JSON number array. Only image extensions are read.
#[tauri::command]
pub(in crate::app) async fn read_server_icon_source(path: String) -> Result<Response, String> {
    run_blocking(move || {
        let path = PathBuf::from(path.trim());
        let metadata = fs::metadata(&path).map_err(|_| "Could not open that image.".to_string())?;
        if !metadata.is_file() {
            return Err("Could not open that image.".to_string());
        }
        validate_server_icon_source(&path, metadata.len())?;
        let bytes = fs::read(&path).map_err(|err| format!("Could not read that image: {err}"))?;
        Ok(Response::new(bytes))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_source_accepts_common_image_types_only() {
        assert!(validate_server_icon_source(Path::new("a/photo.JPG"), 10).is_ok());
        assert!(validate_server_icon_source(Path::new("favicon.ico"), 10).is_ok());
        assert!(validate_server_icon_source(Path::new("notes.txt"), 10).is_err());
        assert!(validate_server_icon_source(Path::new("no-extension"), 10).is_err());
        assert!(
            validate_server_icon_source(Path::new("huge.png"), MAX_SERVER_ICON_SOURCE_BYTES + 1)
                .is_err()
        );
    }

    /// A minimal PNG header (signature + IHDR) for the given size. Enough for
    /// the validator, which only reads the IHDR dimensions.
    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        bytes
    }

    #[test]
    fn icon_validation_accepts_only_a_64_square_png() {
        assert!(validate_server_icon(&png_header(64, 64)).is_ok());
        assert!(
            validate_server_icon(&png_header(128, 128))
                .unwrap_err()
                .contains("128×128")
        );
        assert!(validate_server_icon(b"GIF89a not a png at all......").is_err());
        assert!(validate_server_icon(&[]).is_err());
        let mut huge = png_header(64, 64);
        huge.resize(MAX_SERVER_ICON_BYTES + 1, 0);
        assert!(validate_server_icon(&huge).is_err());
    }

    #[test]
    fn icon_round_trips_as_a_data_url() {
        let dir = tempfile::tempdir().unwrap();
        let directory = dir.path().to_string_lossy().to_string();
        assert_eq!(get_server_icon(directory.clone()).unwrap(), None);

        let png = png_header(64, 64);
        set_server_icon(directory.clone(), png.clone()).unwrap();
        assert_eq!(
            std::fs::read(dir.path().join("server-icon.png")).unwrap(),
            png
        );
        assert!(!dir.path().join("server-icon.png.tmp").exists());

        let url = get_server_icon(directory.clone()).unwrap().unwrap();
        assert!(url.starts_with("data:image/png;base64,iVBORw0KGgo"));

        // A rejected icon leaves the previous one in place.
        assert!(set_server_icon(directory, png_header(32, 32)).is_err());
        assert_eq!(
            std::fs::read(dir.path().join("server-icon.png")).unwrap(),
            png
        );
    }

    #[test]
    fn get_icon_ignores_a_file_that_is_not_a_png() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("server-icon.png"), b"not a png").unwrap();
        assert_eq!(
            get_server_icon(dir.path().to_string_lossy().to_string()).unwrap(),
            None
        );
    }

    #[test]
    fn apply_rejects_keys_outside_the_allowlist() {
        let dir = tempfile::tempdir().unwrap();
        let payload = ApplyServerPropertiesPayload {
            directory: dir.path().to_string_lossy().to_string(),
            updates: vec![PropertyUpdate {
                key: "rcon.password".to_string(),
                value: "hunter2".to_string(),
            }],
        };
        assert!(apply_server_properties(payload).is_err());
    }

    #[test]
    fn apply_preserves_comments_and_other_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("server.properties");
        std::fs::write(
            &path,
            "# a comment\nmotd=Hello\nonline-mode=false\nlevel-name=world\n",
        )
        .unwrap();

        apply_server_properties(ApplyServerPropertiesPayload {
            directory: dir.path().to_string_lossy().to_string(),
            updates: vec![
                PropertyUpdate {
                    key: "online-mode".to_string(),
                    value: "true".to_string(),
                },
                PropertyUpdate {
                    key: "white-list".to_string(),
                    value: "true".to_string(),
                },
            ],
        })
        .unwrap();

        let result = std::fs::read_to_string(&path).unwrap();
        assert!(result.contains("# a comment"));
        assert!(result.contains("online-mode=true"));
        assert!(result.contains("level-name=world"));
        assert!(result.contains("white-list=true"));
        // The pre-existing motd line is untouched.
        assert!(result.contains("motd=Hello"));
    }
}
