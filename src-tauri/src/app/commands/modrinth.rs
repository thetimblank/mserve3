use super::super::support::{
    ContentItemMeta, is_simple_relative_name, item_roots, move_file_with_fallback,
    record_content_meta,
};
use super::providers::{fetch_cached, fetch_text};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512};
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::Duration;

const MODRINTH_API: &str = "https://api.modrinth.com/v2";
const MODRINTH_CDN_HOST: &str = "cdn.modrinth.com";
const TAG_CACHE_TTL_SECS: u64 = 60 * 60; // 1 hour

const ALLOWED_PROJECT_TYPES: [&str; 4] = ["plugin", "datapack", "mod", "modpack"];
const ALLOWED_SEARCH_INDEXES: [&str; 5] =
    ["relevance", "downloads", "follows", "newest", "updated"];

/// Modrinth asks for a uniquely identifying User-Agent with a contact pointer.
fn modrinth_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(concat!(
            "mserve/",
            env!("CARGO_PKG_VERSION"),
            " (github.com/thetimblank/mserve3)"
        ))
        .build()
        .map_err(|err| err.to_string())
}

// ---------------------------------------------------------------------------
// Boundary structs. Modrinth's JSON is snake_case; the IPC boundary is
// camelCase, so these deserialize snake_case and serialize camelCase.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::app) struct ModrinthSearchPayload {
    #[serde(default)]
    query: String,
    project_type: String,
    #[serde(default)]
    loaders: Vec<String>,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    index: Option<String>,
    #[serde(default)]
    offset: u32,
    #[serde(default)]
    limit: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub(in crate::app) struct ModrinthSearchHit {
    project_id: String,
    slug: String,
    title: String,
    description: String,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    display_categories: Vec<String>,
    #[serde(default)]
    versions: Vec<String>,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    follows: u64,
    #[serde(default)]
    icon_url: Option<String>,
    #[serde(default)]
    author: String,
    #[serde(default)]
    date_modified: String,
    #[serde(default)]
    server_side: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub(in crate::app) struct ModrinthSearchResult {
    hits: Vec<ModrinthSearchHit>,
    offset: u32,
    limit: u32,
    total_hits: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::app) struct ModrinthProjectPayload {
    id_or_slug: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub(in crate::app) struct ModrinthProject {
    id: String,
    slug: String,
    title: String,
    description: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    additional_categories: Vec<String>,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    loaders: Vec<String>,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    followers: u64,
    #[serde(default)]
    icon_url: Option<String>,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    updated: String,
    #[serde(default)]
    published: String,
    project_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::app) struct ModrinthVersionsPayload {
    id_or_slug: String,
    #[serde(default)]
    loaders: Vec<String>,
    #[serde(default)]
    game_versions: Vec<String>,
}

/// Raw Modrinth version shape (subset).
#[derive(Debug, Deserialize)]
struct ModrinthVersionRaw {
    id: String,
    project_id: String,
    name: String,
    version_number: String,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    loaders: Vec<String>,
    version_type: String,
    #[serde(default)]
    date_published: String,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    files: Vec<ModrinthVersionFileRaw>,
}

#[derive(Debug, Deserialize)]
struct ModrinthVersionFileRaw {
    url: String,
    filename: String,
    #[serde(default)]
    primary: bool,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    hashes: ModrinthFileHashes,
}

#[derive(Debug, Default, Deserialize)]
struct ModrinthFileHashes {
    #[serde(default)]
    sha512: Option<String>,
}

/// One installable version row, flattened to its primary file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::app) struct ModrinthVersionEntry {
    version_id: String,
    project_id: String,
    name: String,
    version_number: String,
    game_versions: Vec<String>,
    loaders: Vec<String>,
    /// "release" | "beta" | "alpha"
    version_type: String,
    date_published: String,
    downloads: u64,
    file_url: String,
    file_name: String,
    file_size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha512: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub(in crate::app) struct ModrinthCategoryTag {
    name: String,
    project_type: String,
    header: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub(in crate::app) struct ModrinthGameVersionTag {
    version: String,
    version_type: String,
    #[serde(default)]
    major: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::app) struct ModrinthTags {
    categories: Vec<ModrinthCategoryTag>,
    game_versions: Vec<ModrinthGameVersionTag>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::app) struct InstallModrinthFilePayload {
    directory: String,
    /// "plugin" | "datapack" | "mod"
    item_type: String,
    url: String,
    file_name: String,
    #[serde(default)]
    sha512: Option<String>,
    project_id: String,
    version_id: String,
    name: String,
    page_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::app) struct InstallModrinthFileResult {
    file: String,
    size_bytes: u64,
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested below)
// ---------------------------------------------------------------------------

/// Builds the Modrinth `facets` query value. Outer groups AND together, entries
/// inside a group OR — so loaders and game versions each form one OR group,
/// while every explicit category is its own AND group (matches modrinth.com).
fn build_search_facets(
    project_type: &str,
    loaders: &[String],
    game_versions: &[String],
    categories: &[String],
) -> String {
    let mut groups: Vec<Vec<String>> = vec![vec![format!("project_type:{project_type}")]];

    let loader_group: Vec<String> = loaders
        .iter()
        .map(|loader| format!("categories:{loader}"))
        .collect();
    if !loader_group.is_empty() {
        groups.push(loader_group);
    }

    let version_group: Vec<String> = game_versions
        .iter()
        .map(|version| format!("versions:{version}"))
        .collect();
    if !version_group.is_empty() {
        groups.push(version_group);
    }

    for category in categories {
        groups.push(vec![format!("categories:{category}")]);
    }

    serde_json::to_string(&groups).unwrap_or_else(|_| "[]".to_string())
}

/// Plugin/datapack categories live under Modrinth's "mod" tag namespace.
fn tag_project_type(project_type: &str) -> &str {
    match project_type {
        "modpack" => "modpack",
        _ => "mod",
    }
}

fn pick_primary_file(files: &[ModrinthVersionFileRaw]) -> Option<&ModrinthVersionFileRaw> {
    files
        .iter()
        .find(|file| file.primary)
        .or_else(|| files.first())
}

fn to_version_entry(raw: ModrinthVersionRaw) -> Option<ModrinthVersionEntry> {
    let file = pick_primary_file(&raw.files)?;
    Some(ModrinthVersionEntry {
        version_id: raw.id.clone(),
        project_id: raw.project_id.clone(),
        name: raw.name.clone(),
        version_number: raw.version_number.clone(),
        game_versions: raw.game_versions.clone(),
        loaders: raw.loaders.clone(),
        version_type: raw.version_type.clone(),
        date_published: raw.date_published.clone(),
        downloads: raw.downloads,
        file_url: file.url.clone(),
        file_name: file.filename.clone(),
        file_size_bytes: file.size,
        sha512: file.hashes.sha512.clone(),
    })
}

fn is_modrinth_cdn_url(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|parsed| {
        parsed.scheme() == "https" && parsed.host_str() == Some(MODRINTH_CDN_HOST)
    })
}

/// The install target must be a bare file name with the right extension for
/// its slot (plugins/mods are jars, datapacks are zips).
fn validate_install_file_name(item_type: &str, file_name: &str) -> Result<(), String> {
    if !is_simple_relative_name(file_name) {
        return Err("Invalid file name.".to_string());
    }
    let lowered = file_name.to_lowercase();
    let valid = match item_type {
        "plugin" | "mod" => lowered.ends_with(".jar"),
        "datapack" => lowered.ends_with(".zip"),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(format!(
            "Unexpected file type for a {item_type}: {file_name}"
        ))
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub(in crate::app) fn search_modrinth_projects(
    payload: ModrinthSearchPayload,
) -> Result<ModrinthSearchResult, String> {
    let project_type = payload.project_type.trim().to_lowercase();
    if !ALLOWED_PROJECT_TYPES.contains(&project_type.as_str()) {
        return Err(format!(
            "Unsupported Modrinth project type: {project_type}."
        ));
    }

    let index = payload
        .index
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("relevance")
        .to_lowercase();
    if !ALLOWED_SEARCH_INDEXES.contains(&index.as_str()) {
        return Err(format!("Unsupported Modrinth sort index: {index}."));
    }

    let facets = build_search_facets(
        &project_type,
        &payload.loaders,
        &payload.game_versions,
        &payload.categories,
    );
    let limit = payload.limit.unwrap_or(20).clamp(1, 100);

    let client = modrinth_client()?;
    let response = client
        .get(format!("{MODRINTH_API}/search"))
        .query(&[
            ("query", payload.query.trim()),
            ("facets", facets.as_str()),
            ("index", index.as_str()),
            ("offset", payload.offset.to_string().as_str()),
            ("limit", limit.to_string().as_str()),
        ])
        .send()
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Modrinth search failed with HTTP status {}.",
            response.status().as_u16()
        ));
    }

    let text = response.text().map_err(|err| err.to_string())?;
    serde_json::from_str(&text).map_err(|err| err.to_string())
}

#[tauri::command]
pub(in crate::app) fn get_modrinth_project(
    payload: ModrinthProjectPayload,
) -> Result<ModrinthProject, String> {
    let id = payload.id_or_slug.trim();
    if id.is_empty()
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("Invalid Modrinth project id.".to_string());
    }

    let client = modrinth_client()?;
    let text = fetch_text(&client, &format!("{MODRINTH_API}/project/{id}"))?;
    serde_json::from_str(&text).map_err(|err| err.to_string())
}

#[tauri::command]
pub(in crate::app) fn list_modrinth_project_versions(
    payload: ModrinthVersionsPayload,
) -> Result<Vec<ModrinthVersionEntry>, String> {
    let id = payload.id_or_slug.trim();
    if id.is_empty()
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("Invalid Modrinth project id.".to_string());
    }

    let client = modrinth_client()?;
    let mut request = client.get(format!("{MODRINTH_API}/project/{id}/version"));
    if !payload.loaders.is_empty() {
        let loaders = serde_json::to_string(&payload.loaders).map_err(|err| err.to_string())?;
        request = request.query(&[("loaders", loaders.as_str())]);
    }
    if !payload.game_versions.is_empty() {
        let versions =
            serde_json::to_string(&payload.game_versions).map_err(|err| err.to_string())?;
        request = request.query(&[("game_versions", versions.as_str())]);
    }

    let response = request.send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Modrinth version listing failed with HTTP status {}.",
            response.status().as_u16()
        ));
    }

    let text = response.text().map_err(|err| err.to_string())?;
    let raw: Vec<ModrinthVersionRaw> =
        serde_json::from_str(&text).map_err(|err| err.to_string())?;
    Ok(raw.into_iter().filter_map(to_version_entry).collect())
}

#[tauri::command]
pub(in crate::app) fn get_modrinth_tags(project_type: String) -> Result<ModrinthTags, String> {
    let normalized = project_type.trim().to_lowercase();
    if !ALLOWED_PROJECT_TYPES.contains(&normalized.as_str()) {
        return Err(format!("Unsupported Modrinth project type: {normalized}."));
    }

    let client = modrinth_client()?;
    let categories_text = fetch_cached(
        &client,
        &format!("{MODRINTH_API}/tag/category"),
        "modrinth-categories.json",
        TAG_CACHE_TTL_SECS,
    )?;
    let game_versions_text = fetch_cached(
        &client,
        &format!("{MODRINTH_API}/tag/game_version"),
        "modrinth-game-versions.json",
        TAG_CACHE_TTL_SECS,
    )?;

    let all_categories: Vec<ModrinthCategoryTag> =
        serde_json::from_str(&categories_text).map_err(|err| err.to_string())?;
    let game_versions: Vec<ModrinthGameVersionTag> =
        serde_json::from_str(&game_versions_text).map_err(|err| err.to_string())?;

    let wanted_type = tag_project_type(&normalized);
    let categories = all_categories
        .into_iter()
        .filter(|tag| tag.project_type == wanted_type && tag.header == "categories")
        .collect();

    Ok(ModrinthTags {
        categories,
        game_versions,
    })
}

#[tauri::command]
pub(in crate::app) fn install_modrinth_file(
    payload: InstallModrinthFilePayload,
) -> Result<InstallModrinthFileResult, String> {
    let directory = PathBuf::from(payload.directory.trim());
    if !directory.exists() || !directory.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }

    let item_type = payload.item_type.trim();
    let file_name = payload.file_name.trim();
    validate_install_file_name(item_type, file_name)?;

    if !is_modrinth_cdn_url(&payload.url) {
        return Err("Downloads are only allowed from the Modrinth CDN.".to_string());
    }

    // Download into a temp file, hashing as we stream.
    let staging_dir = std::env::temp_dir()
        .join("mserve")
        .join("modrinth-downloads");
    fs::create_dir_all(&staging_dir).map_err(|err| err.to_string())?;
    let temp_path = staging_dir.join(format!("{file_name}.part"));

    let client = modrinth_client()?;
    let mut response = client
        .get(payload.url.trim())
        .send()
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Download failed with HTTP status {}.",
            response.status().as_u16()
        ));
    }

    let mut temp_file = fs::File::create(&temp_path).map_err(|err| err.to_string())?;
    let mut hasher = Sha512::new();
    let mut downloaded_bytes: u64 = 0;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = response.read(&mut buffer).map_err(|err| err.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        temp_file
            .write_all(&buffer[..read])
            .map_err(|err| err.to_string())?;
        downloaded_bytes = downloaded_bytes.saturating_add(read as u64);
    }
    temp_file.flush().map_err(|err| err.to_string())?;
    drop(temp_file);

    if downloaded_bytes == 0 {
        let _ = fs::remove_file(&temp_path);
        return Err("Downloaded file was empty.".to_string());
    }

    if let Some(expected) = payload
        .sha512
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let actual = format!("{:x}", hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = fs::remove_file(&temp_path);
            return Err("Downloaded file failed integrity verification.".to_string());
        }
    }

    let (active_root, _) = item_roots(&directory, item_type)?;
    fs::create_dir_all(&active_root).map_err(|err| err.to_string())?;
    let destination = active_root.join(file_name);
    if destination.exists() {
        fs::remove_file(&destination).map_err(|err| err.to_string())?;
    }
    move_file_with_fallback(&temp_path, &destination)?;

    record_content_meta(
        &directory,
        item_type,
        file_name,
        ContentItemMeta {
            name: payload.name.trim().to_string(),
            project_id: payload.project_id.trim().to_string(),
            version_id: payload.version_id.trim().to_string(),
            page_url: payload.page_url.trim().to_string(),
            source: "modrinth".to_string(),
        },
    )?;

    Ok(InstallModrinthFileResult {
        file: file_name.to_string(),
        size_bytes: downloaded_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn facets_group_loaders_and_versions_as_or_categories_as_and() {
        let facets = build_search_facets(
            "plugin",
            &["paper".to_string(), "spigot".to_string()],
            &["1.21.1".to_string()],
            &["utility".to_string(), "economy".to_string()],
        );
        let parsed: Vec<Vec<String>> = serde_json::from_str(&facets).unwrap();
        assert_eq!(
            parsed,
            vec![
                vec!["project_type:plugin".to_string()],
                vec![
                    "categories:paper".to_string(),
                    "categories:spigot".to_string()
                ],
                vec!["versions:1.21.1".to_string()],
                vec!["categories:utility".to_string()],
                vec!["categories:economy".to_string()],
            ]
        );
    }

    #[test]
    fn facets_omit_empty_groups() {
        let facets = build_search_facets("modpack", &[], &[], &[]);
        let parsed: Vec<Vec<String>> = serde_json::from_str(&facets).unwrap();
        assert_eq!(parsed, vec![vec!["project_type:modpack".to_string()]]);
    }

    #[test]
    fn search_result_deserializes_and_reserializes_camel_case() {
        let json = r#"{
            "hits": [{
                "project_id": "P7dR8mSH",
                "slug": "fabric-api",
                "title": "Fabric API",
                "description": "Core library",
                "categories": ["library"],
                "display_categories": ["library"],
                "versions": ["1.21.1"],
                "downloads": 100,
                "follows": 10,
                "icon_url": "https://cdn.modrinth.com/icon.png",
                "author": "modmuss50",
                "date_modified": "2024-01-01T00:00:00Z",
                "server_side": "required"
            }],
            "offset": 0,
            "limit": 20,
            "total_hits": 1
        }"#;
        let result: ModrinthSearchResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].project_id, "P7dR8mSH");

        let out = serde_json::to_string(&result).unwrap();
        assert!(out.contains("\"projectId\""));
        assert!(out.contains("\"totalHits\""));
        assert!(!out.contains("project_id"));
    }

    #[test]
    fn version_entry_prefers_primary_file() {
        let json = r#"{
            "id": "v1",
            "project_id": "p1",
            "name": "WorldEdit 7.3",
            "version_number": "7.3.0",
            "game_versions": ["1.21"],
            "loaders": ["paper"],
            "version_type": "release",
            "date_published": "2024-01-01T00:00:00Z",
            "downloads": 5,
            "files": [
                {"url": "https://cdn.modrinth.com/a.jar", "filename": "a.jar", "primary": false, "size": 1, "hashes": {"sha512": "aa"}},
                {"url": "https://cdn.modrinth.com/b.jar", "filename": "b.jar", "primary": true, "size": 2, "hashes": {"sha512": "bb"}}
            ]
        }"#;
        let raw: ModrinthVersionRaw = serde_json::from_str(json).unwrap();
        let entry = to_version_entry(raw).unwrap();
        assert_eq!(entry.file_name, "b.jar");
        assert_eq!(entry.sha512.as_deref(), Some("bb"));
    }

    #[test]
    fn version_without_files_is_dropped() {
        let json = r#"{
            "id": "v1", "project_id": "p1", "name": "x", "version_number": "1",
            "game_versions": [], "loaders": [], "version_type": "release",
            "date_published": "", "downloads": 0, "files": []
        }"#;
        let raw: ModrinthVersionRaw = serde_json::from_str(json).unwrap();
        assert!(to_version_entry(raw).is_none());
    }

    #[test]
    fn cdn_url_guard_rejects_other_hosts_and_schemes() {
        assert!(is_modrinth_cdn_url(
            "https://cdn.modrinth.com/data/abc/versions/1/plugin.jar"
        ));
        assert!(!is_modrinth_cdn_url("https://example.com/plugin.jar"));
        assert!(!is_modrinth_cdn_url("http://cdn.modrinth.com/plugin.jar"));
        assert!(!is_modrinth_cdn_url("not a url"));
    }

    #[test]
    fn install_file_names_are_validated_per_item_type() {
        assert!(validate_install_file_name("plugin", "worldedit.jar").is_ok());
        assert!(validate_install_file_name("datapack", "pack.zip").is_ok());
        assert!(validate_install_file_name("plugin", "pack.zip").is_err());
        assert!(validate_install_file_name("plugin", "../evil.jar").is_err());
        assert!(validate_install_file_name("world", "world.zip").is_err());
    }

    #[test]
    fn plugin_and_datapack_tags_use_mod_namespace() {
        assert_eq!(tag_project_type("plugin"), "mod");
        assert_eq!(tag_project_type("datapack"), "mod");
        assert_eq!(tag_project_type("mod"), "mod");
        assert_eq!(tag_project_type("modpack"), "modpack");
    }
}
