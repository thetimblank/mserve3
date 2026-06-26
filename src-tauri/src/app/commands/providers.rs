use super::super::*;
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

const FILL_BASE: &str = "https://fill.papermc.io/v3/projects";
const MOJANG_MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const LIST_CACHE_TTL_SECS: u64 = 60 * 60; // 1 hour
const VANILLA_RESOLVED_CACHE: &str = "vanilla-resolved.json";
const MAX_RESOLVE_WORKERS: usize = 16;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("mserve/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|err| err.to_string())
}

fn fetch_text(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let response = client.get(url).send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Request to {url} failed with HTTP status {}.",
            response.status().as_u16()
        ));
    }
    response.text().map_err(|err| err.to_string())
}

// ---------------------------------------------------------------------------
// Disk cache
// ---------------------------------------------------------------------------

fn cache_dir() -> PathBuf {
    std::env::temp_dir().join("mserve").join("provider-cache")
}

fn cache_path(name: &str) -> PathBuf {
    cache_dir().join(name)
}

fn read_cache_fresh(name: &str, ttl_secs: u64) -> Option<String> {
    let path = cache_path(name);
    let modified = fs::metadata(&path).ok()?.modified().ok()?;
    let age = SystemTime::now().duration_since(modified).ok()?;
    if age.as_secs() > ttl_secs {
        return None;
    }
    fs::read_to_string(&path).ok()
}

fn read_cache_any(name: &str) -> Option<String> {
    fs::read_to_string(cache_path(name)).ok()
}

fn write_cache(name: &str, contents: &str) {
    let dir = cache_dir();
    if fs::create_dir_all(&dir).is_ok() {
        let _ = fs::write(dir.join(name), contents);
    }
}

/// Returns a fresh cache hit, otherwise fetches and re-caches. If the network
/// fetch fails, falls back to a stale cache entry (offline robustness).
fn fetch_cached(
    client: &reqwest::blocking::Client,
    url: &str,
    cache_name: &str,
    ttl_secs: u64,
) -> Result<String, String> {
    if let Some(fresh) = read_cache_fresh(cache_name, ttl_secs) {
        return Ok(fresh);
    }

    match fetch_text(client, url) {
        Ok(text) => {
            write_cache(cache_name, &text);
            Ok(text)
        }
        Err(err) => read_cache_any(cache_name).ok_or(err),
    }
}

// ---------------------------------------------------------------------------
// PaperMC Fill v3 (paper / folia / velocity)
// ---------------------------------------------------------------------------

/// Preserves document order of the Fill `versions` object (newest-first
/// families) instead of letting serde_json's `BTreeMap` re-sort the keys.
struct OrderedVersionFamilies(Vec<(String, Vec<String>)>);

impl<'de> Deserialize<'de> for OrderedVersionFamilies {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct FamilyVisitor;

        impl<'de> Visitor<'de> for FamilyVisitor {
            type Value = OrderedVersionFamilies;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a versions object")
            }

            fn visit_map<M>(self, mut access: M) -> Result<Self::Value, M::Error>
            where
                M: MapAccess<'de>,
            {
                let mut families = Vec::new();
                while let Some((family, versions)) = access.next_entry::<String, Vec<String>>()? {
                    families.push((family, versions));
                }
                Ok(OrderedVersionFamilies(families))
            }
        }

        deserializer.deserialize_map(FamilyVisitor)
    }
}

#[derive(Deserialize)]
struct FillProjectResponse {
    versions: OrderedVersionFamilies,
}

#[derive(Deserialize)]
struct FillBuild {
    id: u64,
    channel: String,
    downloads: BTreeMap<String, FillDownload>,
}

#[derive(Deserialize)]
struct FillDownload {
    name: String,
    url: String,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    checksums: Option<FillChecksums>,
}

#[derive(Deserialize)]
struct FillChecksums {
    sha256: String,
}

/// A version string is treated as unstable when it carries a pre-release marker.
fn version_is_unstable(version: &str) -> bool {
    let lowered = version.to_lowercase();
    [
        "snapshot",
        "-rc",
        "rc-",
        "-pre",
        "pre-",
        "-exp",
        "experimental",
        "beta",
        "alpha",
    ]
    .iter()
    .any(|marker| lowered.contains(marker))
}

fn fill_list_entries(
    client: &reqwest::blocking::Client,
    project: &str,
    tab: &str,
    include_unstable: bool,
) -> Result<Vec<ProviderVersionEntry>, String> {
    let text = fetch_cached(
        client,
        &format!("{FILL_BASE}/{project}"),
        &format!("{project}.json"),
        LIST_CACHE_TTL_SECS,
    )?;
    let response: FillProjectResponse =
        serde_json::from_str(&text).map_err(|err| err.to_string())?;

    let mut entries = Vec::new();
    for (_family, versions) in response.versions.0 {
        for version in versions {
            let unstable = version_is_unstable(&version);
            if unstable && !include_unstable {
                continue;
            }

            let minecraft_version = if project == "velocity" {
                "proxy".to_string()
            } else {
                version.clone()
            };

            entries.push(ProviderVersionEntry {
                provider: project.to_string(),
                tab: tab.to_string(),
                version,
                minecraft_version,
                stability: if unstable { "unstable" } else { "stable" }.to_string(),
            });
        }
    }

    Ok(entries)
}

fn pick_download(build: &FillBuild) -> Result<&FillDownload, String> {
    build
        .downloads
        .get("server:default")
        .or_else(|| build.downloads.values().next())
        .ok_or_else(|| "This build has no downloadable artifact.".to_string())
}

fn resolve_fill(
    client: &reqwest::blocking::Client,
    project: &str,
    version: &str,
    stability: Option<&str>,
) -> Result<ResolvedProvider, String> {
    let text = fetch_text(
        client,
        &format!("{FILL_BASE}/{project}/versions/{version}/builds"),
    )?;
    let builds: Vec<FillBuild> = serde_json::from_str(&text).map_err(|err| err.to_string())?;

    let want_stable = stability
        .map(|value| value.eq_ignore_ascii_case("stable") || value.eq_ignore_ascii_case("release"))
        .unwrap_or(true);

    // Builds are newest-first. Prefer the newest build matching the requested
    // stability; fall back to the newest build overall.
    let chosen = builds
        .iter()
        .find(|build| build.channel.eq_ignore_ascii_case("STABLE") == want_stable)
        .or_else(|| builds.first())
        .ok_or_else(|| format!("No builds are available for {project} {version}."))?;

    let download = pick_download(chosen)?;
    let stable = chosen.channel.eq_ignore_ascii_case("STABLE");

    let (provider_version, minecraft_version) = if project == "velocity" {
        (format!("{version}-{}", chosen.id), "proxy".to_string())
    } else {
        (chosen.id.to_string(), version.to_string())
    };

    Ok(ResolvedProvider {
        name: project.to_string(),
        file: download.name.clone(),
        download_url: download.url.clone(),
        provider_version,
        minecraft_version,
        jdk_versions: Vec::new(),
        stable,
        size_bytes: download.size,
        sha256: download.checksums.as_ref().map(|sums| sums.sha256.clone()),
    })
}

// ---------------------------------------------------------------------------
// Mojang vanilla
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct MojangManifest {
    versions: Vec<MojangVersion>,
}

#[derive(Deserialize, Clone)]
struct MojangVersion {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    url: String,
}

#[derive(Deserialize)]
struct MojangVersionDetail {
    #[serde(default)]
    downloads: Option<MojangDownloads>,
    #[serde(rename = "javaVersion", default)]
    java_version: Option<MojangJava>,
}

#[derive(Deserialize)]
struct MojangDownloads {
    #[serde(default)]
    server: Option<MojangServerDownload>,
}

#[derive(Deserialize)]
struct MojangServerDownload {
    url: String,
    #[serde(default)]
    size: Option<u64>,
}

#[derive(Deserialize)]
struct MojangJava {
    #[serde(rename = "majorVersion")]
    major_version: u32,
}

/// Immutable, permanently cached resolution of a single vanilla version.
#[derive(Serialize, Deserialize, Clone)]
struct VanillaResolved {
    has_jar: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    size: Option<u64>,
    #[serde(default)]
    java_major: u32,
    #[serde(rename = "type")]
    kind: String,
}

fn load_vanilla_resolved() -> BTreeMap<String, VanillaResolved> {
    read_cache_any(VANILLA_RESOLVED_CACHE)
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_vanilla_resolved(map: &BTreeMap<String, VanillaResolved>) {
    if let Ok(text) = serde_json::to_string(map) {
        write_cache(VANILLA_RESOLVED_CACHE, &text);
    }
}

/// Fetches a single version's metadata. Returns `None` on network/parse failure
/// so the caller never caches a transient error as a permanent "no jar".
fn resolve_one_vanilla(
    client: &reqwest::blocking::Client,
    version: &MojangVersion,
) -> Option<VanillaResolved> {
    let text = fetch_text(client, &version.url).ok()?;
    let detail: MojangVersionDetail = serde_json::from_str(&text).ok()?;
    let server = detail.downloads.and_then(|downloads| downloads.server);

    Some(match server {
        Some(server) => VanillaResolved {
            has_jar: true,
            url: Some(server.url),
            size: server.size,
            java_major: detail
                .java_version
                .map(|java| java.major_version)
                .unwrap_or(0),
            kind: version.kind.clone(),
        },
        None => VanillaResolved {
            has_jar: false,
            url: None,
            size: None,
            java_major: 0,
            kind: version.kind.clone(),
        },
    })
}

fn resolve_many_vanilla(
    client: &reqwest::blocking::Client,
    items: Vec<MojangVersion>,
) -> Vec<(String, VanillaResolved)> {
    if items.is_empty() {
        return Vec::new();
    }

    let queue = Arc::new(Mutex::new(items));
    let results = Arc::new(Mutex::new(Vec::new()));
    let worker_count = MAX_RESOLVE_WORKERS
        .min(queue.lock().map(|q| q.len()).unwrap_or(1))
        .max(1);

    let mut handles = Vec::with_capacity(worker_count);
    for _ in 0..worker_count {
        let queue = Arc::clone(&queue);
        let results = Arc::clone(&results);
        let client = client.clone();
        handles.push(std::thread::spawn(move || {
            loop {
                let next = {
                    let mut guard = match queue.lock() {
                        Ok(guard) => guard,
                        Err(_) => break,
                    };
                    guard.pop()
                };
                let Some(version) = next else {
                    break;
                };
                if let Some(resolved) = resolve_one_vanilla(&client, &version)
                    && let Ok(mut guard) = results.lock()
                {
                    guard.push((version.id.clone(), resolved));
                }
            }
        }));
    }

    for handle in handles {
        let _ = handle.join();
    }

    Arc::try_unwrap(results)
        .ok()
        .and_then(|mutex| mutex.into_inner().ok())
        .unwrap_or_default()
}

fn vanilla_list_entries(
    client: &reqwest::blocking::Client,
    include_unstable: bool,
) -> Result<Vec<ProviderVersionEntry>, String> {
    let manifest_text = fetch_cached(
        client,
        MOJANG_MANIFEST,
        "vanilla-manifest.json",
        LIST_CACHE_TTL_SECS,
    )?;
    let manifest: MojangManifest =
        serde_json::from_str(&manifest_text).map_err(|err| err.to_string())?;

    // Releases by default; snapshots only when explicitly requested (their
    // per-version resolution is the expensive part).
    let wanted: Vec<&MojangVersion> = manifest
        .versions
        .iter()
        .filter(|version| {
            version.kind == "release" || (include_unstable && version.kind == "snapshot")
        })
        .collect();

    let mut resolved = load_vanilla_resolved();
    let pending: Vec<MojangVersion> = wanted
        .iter()
        .filter(|version| !resolved.contains_key(&version.id))
        .map(|version| (*version).clone())
        .collect();

    if !pending.is_empty() {
        for (id, entry) in resolve_many_vanilla(client, pending) {
            resolved.insert(id, entry);
        }
        save_vanilla_resolved(&resolved);
    }

    let mut entries = Vec::new();
    for version in wanted {
        let Some(entry) = resolved.get(&version.id) else {
            continue;
        };
        if !entry.has_jar {
            continue;
        }
        entries.push(ProviderVersionEntry {
            provider: "vanilla".to_string(),
            tab: "vanilla".to_string(),
            version: version.id.clone(),
            minecraft_version: version.id.clone(),
            stability: version.kind.clone(),
        });
    }

    Ok(entries)
}

fn resolve_vanilla(
    client: &reqwest::blocking::Client,
    version: &str,
) -> Result<ResolvedProvider, String> {
    let mut resolved = load_vanilla_resolved();

    let entry = match resolved.get(version) {
        Some(entry) if entry.has_jar => entry.clone(),
        _ => {
            let manifest_text = fetch_cached(
                client,
                MOJANG_MANIFEST,
                "vanilla-manifest.json",
                LIST_CACHE_TTL_SECS,
            )?;
            let manifest: MojangManifest =
                serde_json::from_str(&manifest_text).map_err(|err| err.to_string())?;
            let mojang_version = manifest
                .versions
                .iter()
                .find(|candidate| candidate.id == version)
                .ok_or_else(|| format!("Unknown Minecraft version: {version}."))?;

            let resolved_entry = resolve_one_vanilla(client, mojang_version)
                .ok_or_else(|| format!("Failed to resolve metadata for Minecraft {version}."))?;
            resolved.insert(version.to_string(), resolved_entry.clone());
            save_vanilla_resolved(&resolved);
            resolved_entry
        }
    };

    if !entry.has_jar {
        return Err(format!(
            "Minecraft {version} has no downloadable server jar."
        ));
    }

    let download_url = entry
        .url
        .clone()
        .ok_or_else(|| format!("Minecraft {version} is missing a download URL."))?;

    Ok(ResolvedProvider {
        name: "vanilla".to_string(),
        file: format!("vanilla-{version}.jar"),
        download_url,
        provider_version: entry.kind.clone(),
        minecraft_version: version.to_string(),
        jdk_versions: if entry.java_major > 0 {
            vec![entry.java_major]
        } else {
            vec![21]
        },
        stable: entry.kind == "release",
        size_bytes: entry.size,
        sha256: None,
    })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub(in crate::app) fn list_provider_versions(
    payload: ListProviderVersionsPayload,
) -> Result<Vec<ProviderVersionEntry>, String> {
    let client = http_client()?;
    let include_unstable = payload.include_unstable;

    match payload.tab.trim().to_lowercase().as_str() {
        "plugin" => {
            let mut entries = fill_list_entries(&client, "paper", "plugin", include_unstable)?;
            entries.extend(fill_list_entries(
                &client,
                "folia",
                "plugin",
                include_unstable,
            )?);
            Ok(entries)
        }
        "proxies" => fill_list_entries(&client, "velocity", "proxies", include_unstable),
        "vanilla" => vanilla_list_entries(&client, include_unstable),
        other => Err(format!("Unsupported provider tab: {other}.")),
    }
}

#[tauri::command]
pub(in crate::app) fn resolve_provider_version(
    payload: ResolveProviderVersionPayload,
) -> Result<ResolvedProvider, String> {
    let client = http_client()?;
    let provider = payload.provider.trim().to_lowercase();
    let version = payload.version.trim();
    if version.is_empty() {
        return Err("A version is required to resolve a provider build.".to_string());
    }

    match provider.as_str() {
        "paper" | "folia" | "velocity" => {
            resolve_fill(&client, &provider, version, payload.stability.as_deref())
        }
        "vanilla" => resolve_vanilla(&client, version),
        other => Err(format!("Unsupported provider: {other}.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_prerelease_markers_as_unstable() {
        for v in [
            "1.21-pre1",
            "1.20.5-rc1",
            "23w13a-snapshot",
            "1.0-experimental",
            "2.0-beta",
            "1.0-alpha",
        ] {
            assert!(version_is_unstable(v), "{v} should be unstable");
        }
    }

    #[test]
    fn release_versions_are_stable() {
        for v in ["1.21", "1.20.1", "1.19.4", "1.8.8"] {
            assert!(!version_is_unstable(v), "{v} should be stable");
        }
    }

    #[test]
    fn fill_versions_object_preserves_document_order() {
        // serde_json would re-sort a BTreeMap; the custom deserializer must keep
        // the server's newest-first family order so the picker shows latest first.
        let json = r#"{"versions": {"1.21": ["1.21.1", "1.21"], "1.20": ["1.20.6"]}}"#;
        let parsed: FillProjectResponse = serde_json::from_str(json).unwrap();
        let families: Vec<&str> = parsed.versions.0.iter().map(|(f, _)| f.as_str()).collect();
        assert_eq!(families, vec!["1.21", "1.20"]);
        assert_eq!(parsed.versions.0[0].1, vec!["1.21.1", "1.21"]);
    }

    #[test]
    fn pick_download_prefers_server_default() {
        let json = r#"{
            "id": 196,
            "channel": "STABLE",
            "downloads": {
                "server:default": {"name": "paper-1.20.1-196.jar", "url": "https://x/paper.jar", "size": 123, "checksums": {"sha256": "abc"}},
                "mojang-mappings": {"name": "mappings.txt", "url": "https://x/m.txt"}
            }
        }"#;
        let build: FillBuild = serde_json::from_str(json).unwrap();
        let download = pick_download(&build).unwrap();
        assert_eq!(download.name, "paper-1.20.1-196.jar");
        assert_eq!(download.size, Some(123));
        assert_eq!(download.checksums.as_ref().unwrap().sha256, "abc");
    }

    #[test]
    fn pick_download_falls_back_to_any_artifact() {
        let json = r#"{
            "id": 5,
            "channel": "STABLE",
            "downloads": {"only-one": {"name": "thing.jar", "url": "https://x/thing.jar"}}
        }"#;
        let build: FillBuild = serde_json::from_str(json).unwrap();
        assert_eq!(pick_download(&build).unwrap().name, "thing.jar");
    }

    #[test]
    fn pick_download_errors_when_no_artifacts() {
        let json = r#"{"id": 1, "channel": "STABLE", "downloads": {}}"#;
        let build: FillBuild = serde_json::from_str(json).unwrap();
        assert!(pick_download(&build).is_err());
    }

    #[test]
    fn mojang_manifest_deserializes() {
        let json = r#"{"latest":{"release":"1.21"},"versions":[
            {"id":"1.21","type":"release","url":"https://x/1.21.json"},
            {"id":"23w13a","type":"snapshot","url":"https://x/snap.json"}
        ]}"#;
        let manifest: MojangManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.versions.len(), 2);
        assert_eq!(manifest.versions[0].id, "1.21");
    }
}
