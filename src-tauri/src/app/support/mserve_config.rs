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

pub(in crate::app) fn default_auto_backup() -> Vec<String> {
    vec![]
}

pub(in crate::app) fn default_custom_flags() -> Vec<String> {
    vec!["--nogui".to_string()]
}

pub(in crate::app) fn default_provider_checks() -> ProviderChecksConfig {
    ProviderChecksConfig {
        list_polling: true,
        tps_polling: true,
        version_polling: true,
        online_polling: true,
        ram_polling: true,
        cpu_polling: true,
        provider_polling: true,
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

pub(in crate::app) fn default_synced_config(directory: &Path) -> SyncedMserveConfig {
    let fallback_file = find_first_jar_file_name(directory).unwrap_or_else(|| "server.jar".to_string());
    SyncedMserveConfig {
        id: generate_server_id(),
        file: fallback_file,
        ram: 4,
        storage_limit: 200,
        auto_backup: default_auto_backup(),
        auto_backup_interval: 120,
        auto_restart: false,
        custom_flags: default_custom_flags(),
        java_installation: None,
        provider: None,
        version: None,
        provider_checks: default_provider_checks(),
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

pub(in crate::app) fn sanitize_provider_checks(raw: Option<&serde_json::Value>) -> ProviderChecksConfig {
    let defaults = default_provider_checks();
    let Some(value) = raw else {
        return defaults;
    };

    let Some(object) = value.as_object() else {
        return defaults;
    };

    ProviderChecksConfig {
        list_polling: object
            .get("list_polling")
            .and_then(|value| value.as_bool())
            .unwrap_or(defaults.list_polling),
        tps_polling: object
            .get("tps_polling")
            .and_then(|value| value.as_bool())
            .unwrap_or(defaults.tps_polling),
        version_polling: object
            .get("version_polling")
            .and_then(|value| value.as_bool())
            .unwrap_or(defaults.version_polling),
        online_polling: object
            .get("online_polling")
            .and_then(|value| value.as_bool())
            .unwrap_or(defaults.online_polling),
        ram_polling: object
            .get("ram_polling")
            .and_then(|value| value.as_bool())
            .unwrap_or(defaults.ram_polling),
        cpu_polling: object
            .get("cpu_polling")
            .and_then(|value| value.as_bool())
            .unwrap_or(defaults.cpu_polling),
        provider_polling: object
            .get("provider_polling")
            .and_then(|value| value.as_bool())
            .unwrap_or(defaults.provider_polling),
    }
}

pub(in crate::app) fn infer_provider_from_jar_file(file_name: &str) -> Option<String> {
    let normalized = file_name.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }

    if normalized.contains("paper") {
        return Some("Paper".to_string());
    }
    if normalized.contains("folia") {
        return Some("Folia".to_string());
    }
    if normalized.contains("spigot") {
        return Some("Spigot".to_string());
    }
    if normalized.contains("velocity") {
        return Some("Velocity".to_string());
    }
    if normalized.contains("bungeecord") || normalized.contains("bungee") {
        return Some("Bungeecord".to_string());
    }
    if normalized.contains("vanilla") || normalized == "server.jar" {
        return Some("Vanilla".to_string());
    }

    None
}

pub(in crate::app) fn infer_version_from_jar_file(file_name: &str) -> Option<String> {
    let normalized = file_name.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }

    for token in normalized
        .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '.')
        .filter(|token| !token.is_empty())
    {
        let has_dot = token.contains('.');
        let starts_with_number = token.chars().next().map(|ch| ch.is_ascii_digit()).unwrap_or(false);
        if has_dot && starts_with_number {
            return Some(token.to_string());
        }
    }

    None
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

    let normalized_auto_backup = normalize_auto_backup(object.get("auto_backup"))
        .unwrap_or_else(default_auto_backup);

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

    let normalized_provider = object
        .get("provider")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| infer_provider_from_jar_file(&normalized_file));

    let normalized_version = object
        .get("version")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| infer_version_from_jar_file(&normalized_file));

    let normalized_provider_checks = sanitize_provider_checks(object.get("provider_checks"));

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
    config.version = normalized_version;
    config.provider_checks = normalized_provider_checks;
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
        "version": config.version,
        "provider_checks": config.provider_checks,
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
        "version",
        "provider_checks",
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

    if object
        .get("storage_limit")
        .and_then(|value| value.as_u64())
        .is_none()
    {
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

    if object
        .get("auto_restart")
        .and_then(|value| value.as_bool())
        .is_none()
    {
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

