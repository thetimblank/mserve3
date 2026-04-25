use super::super::*;
use super::*;
use serde::de::{self, MapAccess, Visitor};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

struct TopLevelObject(Map<String, Value>);

impl<'de> Deserialize<'de> for TopLevelObject {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct TopLevelObjectVisitor;

        impl<'de> Visitor<'de> for TopLevelObjectVisitor {
            type Value = TopLevelObject;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a JSON object")
            }

            fn visit_map<M>(self, mut access: M) -> Result<Self::Value, M::Error>
            where
                M: MapAccess<'de>,
            {
                let mut values = Map::new();

                while let Some((key, value)) = access.next_entry::<String, Value>()? {
                    if values.contains_key(&key) {
                        return Err(de::Error::custom(format!("Duplicate key found: {key}")));
                    }
                    values.insert(key, value);
                }

                Ok(TopLevelObject(values))
            }
        }

        deserializer.deserialize_map(TopLevelObjectVisitor)
    }
}

const ALL_SUPPORTED_TELEMETRY: [&str; 7] = [
    "list",
    "tps",
    "version",
    "online",
    "ram",
    "cpu",
    "provider",
];

pub(in crate::app) fn default_auto_backup() -> Vec<String> {
    vec![]
}

pub(in crate::app) fn default_custom_flags() -> Vec<String> {
    vec![]
}

pub(in crate::app) fn default_supported_telemetry() -> Vec<String> {
    ALL_SUPPORTED_TELEMETRY
        .iter()
        .map(|value| value.to_string())
        .collect()
}

pub(in crate::app) fn provider_supports_telemetry(provider: &MserveProvider, key: &str) -> bool {
    let normalized_key = key.trim().to_lowercase();
    provider
        .supported_telemetry
        .iter()
        .any(|entry| entry.trim().eq_ignore_ascii_case(&normalized_key))
}

fn default_jdk_versions_for_provider(provider_name: &str) -> Vec<u32> {
    match provider_name {
        "velocity" | "bungeecord" => vec![17, 21],
        _ => vec![21],
    }
}

fn normalize_provider_name(raw: &str) -> Option<String> {
    let normalized = raw.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }

    if normalized.contains("paper") {
        return Some("paper".to_string());
    }
    if normalized.contains("folia") {
        return Some("folia".to_string());
    }
    if normalized.contains("spigot") || normalized.contains("bukkit") {
        return Some("spigot".to_string());
    }
    if normalized.contains("velocity") {
        return Some("velocity".to_string());
    }
    if normalized.contains("bungeecord") || normalized.contains("bungee") || normalized.contains("waterfall") {
        return Some("bungeecord".to_string());
    }
    if normalized.contains("vanilla")
        || normalized.contains("mojang")
        || normalized.contains("minecraft")
    {
        return Some("vanilla".to_string());
    }

    None
}

pub(in crate::app) fn infer_provider_from_jar_file(file_name: &str) -> Option<String> {
    normalize_provider_name(file_name)
}

pub(in crate::app) fn infer_version_from_jar_file(file_name: &str) -> Option<String> {
    let normalized = file_name.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }

    for token in normalized
        .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '.' && ch != '-')
        .filter(|token| !token.is_empty())
    {
        let has_dot = token.contains('.');
        let starts_with_number = token
            .chars()
            .next()
            .map(|ch| ch.is_ascii_digit())
            .unwrap_or(false);
        if has_dot && starts_with_number {
            return Some(token.to_string());
        }
    }

    None
}

pub(in crate::app) fn default_provider_for_file(file_name: &str) -> MserveProvider {
    let provider_name = infer_provider_from_jar_file(file_name).unwrap_or_else(|| "vanilla".to_string());
    let inferred_version = infer_version_from_jar_file(file_name).unwrap_or_default();
    let minecraft_version = if provider_name == "velocity" || provider_name == "bungeecord" {
        if inferred_version.is_empty() {
            "proxy".to_string()
        } else {
            inferred_version.clone()
        }
    } else {
        inferred_version.clone()
    };

    MserveProvider {
        name: provider_name.clone(),
        file: file_name.trim().to_string(),
        download_url: None,
        provider_version: inferred_version,
        minecraft_version,
        jdk_versions: default_jdk_versions_for_provider(&provider_name),
        supported_telemetry: default_supported_telemetry(),
        stable: true,
    }
}

pub(in crate::app) fn normalize_provider(provider: &MserveProvider, fallback_file: &str) -> MserveProvider {
    let fallback = default_provider_for_file(fallback_file);
    let name = normalize_provider_name(&provider.name).unwrap_or_else(|| fallback.name.clone());

    let file = provider
        .file
        .trim()
        .strip_prefix("./")
        .unwrap_or(provider.file.trim())
        .to_string();
    let file = if file.is_empty() {
        fallback.file.clone()
    } else {
        file
    };

    let provider_version = provider.provider_version.trim().to_string();
    let minecraft_version = provider.minecraft_version.trim().to_string();

    let mut jdk_versions: Vec<u32> = provider
        .jdk_versions
        .iter()
        .copied()
        .filter(|value| *value > 0)
        .collect();
    jdk_versions.sort_unstable();
    jdk_versions.dedup();
    if jdk_versions.is_empty() {
        jdk_versions = default_jdk_versions_for_provider(&name);
    }

    let supported_telemetry = if provider.supported_telemetry.is_empty() {
        fallback.supported_telemetry.clone()
    } else {
        provider.supported_telemetry.clone()
    };
    let download_url = provider
        .download_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    MserveProvider {
        name,
        file,
        download_url,
        provider_version: if provider_version.is_empty() {
            fallback.provider_version
        } else {
            provider_version
        },
        minecraft_version: if minecraft_version.is_empty() {
            fallback.minecraft_version
        } else {
            minecraft_version
        },
        jdk_versions,
        supported_telemetry,
        stable: provider.stable,
    }
}

pub(in crate::app) fn default_telemetry_host() -> String {
    "127.0.0.1".to_string()
}

fn parse_server_properties_port(directory: &Path) -> Option<u16> {
    let properties_path = directory.join("server.properties");
    let raw = fs::read_to_string(properties_path).ok()?;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("server-port=") {
            let parsed = value.trim().parse::<u16>().ok()?;
            if parsed > 0 {
                return Some(parsed);
            }
        }
    }

    None
}

pub(in crate::app) fn detect_default_telemetry_port(directory: &Path) -> u16 {
    parse_server_properties_port(directory).unwrap_or(25565)
}

pub(in crate::app) fn sanitize_telemetry_host(raw: Option<&serde_json::Value>) -> String {
    raw.and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(default_telemetry_host)
}

pub(in crate::app) fn sanitize_telemetry_port(directory: &Path, raw: Option<&serde_json::Value>) -> u16 {
    let parsed = raw
        .and_then(|value| value.as_u64())
        .and_then(|value| u16::try_from(value).ok())
        .filter(|value| *value > 0);

    parsed.unwrap_or_else(|| detect_default_telemetry_port(directory))
}

pub(in crate::app) fn generate_server_id() -> String {
    let stamp = chrono::Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_else(|| chrono::Utc::now().timestamp_micros());
    format!("srv-{stamp}")
}

fn sanitize_provider(raw: Option<&serde_json::Value>, fallback_file: &str) -> MserveProvider {
    let fallback = default_provider_for_file(fallback_file);
    let Some(value) = raw else {
        return fallback;
    };
    let Some(object) = value.as_object() else {
        return fallback;
    };

    let raw_name = object
        .get("name")
        .and_then(|entry| entry.as_str())
        .unwrap_or(&fallback.name);
    let name = normalize_provider_name(raw_name).unwrap_or_else(|| fallback.name.clone());

    let file = object
        .get("file")
        .and_then(|entry| entry.as_str())
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .unwrap_or(fallback_file)
        .to_string();

    let download_url = object
        .get("download_url")
        .and_then(|entry| entry.as_str())
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(|entry| entry.to_string());

    let provider_version = object
        .get("provider_version")
        .and_then(|entry| entry.as_str())
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(|entry| entry.to_string())
        .unwrap_or_else(|| fallback.provider_version.clone());

    let minecraft_version = object
        .get("minecraft_version")
        .and_then(|entry| entry.as_str())
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(|entry| entry.to_string())
        .unwrap_or_else(|| fallback.minecraft_version.clone());

    let jdk_versions = object
        .get("jdk_versions")
        .and_then(|entry| entry.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_u64())
                .filter_map(|item| u32::try_from(item).ok())
                .collect::<Vec<u32>>()
        })
        .unwrap_or_else(|| fallback.jdk_versions.clone());

    let supported_telemetry = object
        .get("supported_telemetry")
        .and_then(|entry| entry.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.to_string())
                .collect::<Vec<String>>()
        })
        .unwrap_or_else(default_supported_telemetry);

    let stable = object
        .get("stable")
        .and_then(|entry| entry.as_bool())
        .unwrap_or(true);

    normalize_provider(
        &MserveProvider {
            name,
            file,
            download_url,
            provider_version,
            minecraft_version,
            jdk_versions,
            supported_telemetry,
            stable,
        },
        fallback_file,
    )
}

pub(in crate::app) fn default_synced_config(directory: &Path) -> SyncedMserveConfig {
    let fallback_file = find_first_jar_file_name(directory).unwrap_or_else(|| "server.jar".to_string());
    SyncedMserveConfig {
        id: generate_server_id(),
        file: fallback_file.clone(),
        ram: 4,
        storage_limit: 200,
        auto_backup: default_auto_backup(),
        auto_backup_interval: 120,
        auto_restart: false,
        custom_flags: default_custom_flags(),
        java_installation: None,
        provider: default_provider_for_file(&fallback_file),
        telemetry_host: default_telemetry_host(),
        telemetry_port: detect_default_telemetry_port(directory),
        created_at: chrono::Local::now().to_rfc3339(),
    }
}

pub(in crate::app) fn find_first_jar_file_name(directory: &Path) -> Option<String> {
    if let Ok(entries) = fs::read_dir(directory) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if name.to_lowercase().ends_with(".jar") {
                return Some(name.to_string());
            }
        }
    }

    None
}

pub(in crate::app) fn normalize_auto_backup(raw: Option<&serde_json::Value>) -> Option<Vec<String>> {
    let Some(value) = raw else {
        return Some(default_auto_backup());
    };

    let Some(items) = value.as_array() else {
        return None;
    };

    let mut output = Vec::new();
    for item in items {
        let Some(mode) = item.as_str() else {
            continue;
        };
        if matches!(mode, "interval" | "on_close" | "on_start") {
            if !output.iter().any(|existing| existing == mode) {
                output.push(mode.to_string());
            }
        }
    }

    Some(output)
}

pub(in crate::app) fn normalize_custom_flags(flags: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut output = Vec::new();

    for flag in flags {
        let trimmed = flag.trim();
        if trimmed.is_empty() {
            continue;
        }

        if output.iter().any(|existing: &String| existing == trimmed) {
            continue;
        }

        output.push(trimmed.to_string());
    }

    output
}

pub(in crate::app) fn sanitize_custom_flags(raw: Option<&serde_json::Value>) -> Vec<String> {
    let Some(value) = raw else {
        return default_custom_flags();
    };

    let Some(items) = value.as_array() else {
        return default_custom_flags();
    };

    let flags = items
        .iter()
        .filter_map(|item| item.as_str().map(|flag| flag.to_string()));

    normalize_custom_flags(flags)
}

pub(in crate::app) fn sanitize_mserve_value_config(
    directory: &Path,
    object: &serde_json::Map<String, serde_json::Value>,
) -> SyncedMserveConfig {
    let mut config = default_synced_config(directory);

    let normalized_id = object
        .get("id")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(generate_server_id);

    let normalized_file = object
        .get("file")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty() && value.to_lowercase().ends_with(".jar"))
        .map(|value| value.to_string())
        .or_else(|| find_first_jar_file_name(directory))
        .unwrap_or_else(|| "server.jar".to_string());

    let normalized_ram = object
        .get("ram")
        .and_then(|value| value.as_u64())
        .map(|value| value.max(1) as u32)
        .unwrap_or(3);

    let normalized_storage_limit = object
        .get("storage_limit")
        .and_then(|value| value.as_u64())
        .map(|value| value.max(1) as u32)
        .unwrap_or(200);

    let normalized_auto_backup = normalize_auto_backup(object.get("auto_backup")).unwrap_or_else(default_auto_backup);

    let normalized_interval = object
        .get("auto_backup_interval")
        .and_then(|value| value.as_u64())
        .map(|value| value.max(1) as u32)
        .unwrap_or(120);

    let normalized_auto_restart = object
        .get("auto_restart")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let normalized_custom_flags = sanitize_custom_flags(object.get("custom_flags"));

    let normalized_java_installation = object
        .get("java_installation")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let normalized_provider = sanitize_provider(object.get("provider"), &normalized_file);

    let normalized_telemetry_host = sanitize_telemetry_host(object.get("telemetry_host"));

    let normalized_telemetry_port = sanitize_telemetry_port(directory, object.get("telemetry_port"));

    let normalized_created_at = object
        .get("created_at")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| chrono::Local::now().to_rfc3339());

    config.file = normalized_file;
    config.id = normalized_id;
    config.ram = normalized_ram;
    config.storage_limit = normalized_storage_limit;
    config.auto_backup = normalized_auto_backup;
    config.auto_backup_interval = normalized_interval;
    config.auto_restart = normalized_auto_restart;
    config.custom_flags = normalized_custom_flags;
    config.java_installation = normalized_java_installation;
    config.provider = normalized_provider;
    config.telemetry_host = normalized_telemetry_host;
    config.telemetry_port = normalized_telemetry_port;
    config.created_at = normalized_created_at;

    config
}

pub(in crate::app) fn synced_mserve_json_value(config: &SyncedMserveConfig) -> serde_json::Value {
    serde_json::json!({
        "id": config.id,
        "file": config.file,
        "ram": config.ram.max(1),
        "storage_limit": config.storage_limit.max(1),
        "auto_backup": config.auto_backup,
        "auto_backup_interval": config.auto_backup_interval.max(1),
        "auto_restart": config.auto_restart,
        "custom_flags": config.custom_flags,
        "java_installation": config.java_installation,
        "provider": config.provider,
        "telemetry_host": config.telemetry_host,
        "telemetry_port": config.telemetry_port,
        "created_at": config.created_at,
    })
}

pub(in crate::app) fn synced_mserve_json_string(config: &SyncedMserveConfig) -> Result<String, String> {
    serde_json::to_string_pretty(&synced_mserve_json_value(config)).map_err(|err| err.to_string())
}

pub(in crate::app) fn write_synced_mserve_json(directory: &Path, config: &SyncedMserveConfig) -> Result<(), String> {
    fs::write(
        directory.join("mserve.json"),
        serde_json::to_vec_pretty(&synced_mserve_json_value(config)).map_err(|err| err.to_string())?,
    )
    .map_err(|err| err.to_string())
}

pub(in crate::app) fn validate_mserve_json_keys(
    object: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let allowed = [
        "id",
        "file",
        "ram",
        "storage_limit",
        "auto_backup",
        "auto_backup_interval",
        "auto_restart",
        "custom_flags",
        "java_installation",
        "provider",
        "telemetry_host",
        "telemetry_port",
        "created_at",
    ];

    for key in object.keys() {
        if !allowed.iter().any(|allowed_key| allowed_key == key) {
            return Err(format!("Unsupported key found: {key}"));
        }
    }

    Ok(())
}

pub(in crate::app) fn has_required_mserve_json_fields(
    object: &serde_json::Map<String, serde_json::Value>,
) -> bool {
    if object
        .get("id")
        .and_then(|value| value.as_str())
        .map(|value| !value.trim().is_empty())
        != Some(true)
    {
        return false;
    }

    if object
        .get("file")
        .and_then(|value| value.as_str())
        .map(|value| !value.trim().is_empty() && value.to_lowercase().ends_with(".jar"))
        != Some(true)
    {
        return false;
    }

    if object.get("ram").and_then(|value| value.as_u64()).is_none() {
        return false;
    }

    if object.get("storage_limit").and_then(|value| value.as_u64()).is_none() {
        return false;
    }

    if object.get("auto_backup").and_then(|value| value.as_array()).is_none() {
        return false;
    }

    if object
        .get("auto_backup_interval")
        .and_then(|value| value.as_u64())
        .is_none()
    {
        return false;
    }

    if object.get("auto_restart").and_then(|value| value.as_bool()).is_none() {
        return false;
    }

    if object.get("provider").and_then(|value| value.as_object()).is_none() {
        return false;
    }

    object
        .get("created_at")
        .and_then(|value| value.as_str())
        .map(|value| !value.trim().is_empty())
        == Some(true)
}

pub(in crate::app) fn parse_mserve_top_level_object(raw: &str) -> Result<Map<String, Value>, String> {
    let parsed: TopLevelObject = serde_json::from_str(raw).map_err(|err| err.to_string())?;
    Ok(parsed.0)
}

pub(in crate::app) fn resolve_repair_file(directory: &Path, raw_file: &str) -> Result<String, String> {
    let trimmed = raw_file.trim();
    if trimmed.is_empty() {
        return Ok(find_first_jar_file_name(directory).unwrap_or_else(|| "server.jar".to_string()));
    }

    let input_path = PathBuf::from(trimmed);

    if input_path.is_absolute() || input_path.components().count() > 1 {
        if !trimmed.to_lowercase().ends_with(".jar") {
            return Err("Server file must be a .jar file.".to_string());
        }

        if let Ok((copied_file, _)) = copy_jar_to_server_directory(directory, trimmed) {
            return Ok(copied_file);
        }

        let fallback_name = input_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.trim())
            .filter(|name| !name.is_empty() && name.to_lowercase().ends_with(".jar"))
            .map(|name| name.to_string())
            .unwrap_or_else(|| "server.jar".to_string());

        return Ok(fallback_name);
    }

    if !trimmed.to_lowercase().ends_with(".jar") {
        return Err("Server file must be a .jar file.".to_string());
    }

    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalize_custom_flags_trims_and_dedupes() {
        let normalized = normalize_custom_flags(vec![
            " --nogui ".to_string(),
            " ".to_string(),
            "--nogui".to_string(),
            "--world-dir worlds/main".to_string(),
            "  --world-dir worlds/main  ".to_string(),
        ]);

        assert_eq!(
            normalized,
            vec!["--nogui".to_string(), "--world-dir worlds/main".to_string()]
        );
    }

    #[test]
    fn sanitize_custom_flags_defaults_when_missing() {
        assert_eq!(sanitize_custom_flags(None), default_custom_flags());
    }

    #[test]
    fn sanitize_custom_flags_defaults_when_not_array() {
        let value = json!("--nogui");
        assert_eq!(sanitize_custom_flags(Some(&value)), default_custom_flags());
    }

    #[test]
    fn sanitize_custom_flags_preserves_explicit_empty_array() {
        let value = json!([]);
        assert!(sanitize_custom_flags(Some(&value)).is_empty());
    }
}
