use super::super::*;
use super::mserve_config::{
    default_telemetry_host, detect_default_telemetry_port, infer_provider_from_jar_file,
};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Default)]
pub(in crate::app) struct StatusPingResult {
    pub online: bool,
    pub players_online: Option<u32>,
    pub players_max: Option<u32>,
    pub server_version: Option<String>,
}

#[derive(Default, Clone)]
pub(in crate::app) struct ProcessMetricsResult {
    pub ram_used: Option<f64>,
    pub cpu_used: Option<f64>,
}

struct CachedProcessMetrics {
    measured_at: Instant,
    metrics: ProcessMetricsResult,
}

static PROCESS_METRICS_CACHE: OnceLock<Mutex<HashMap<u32, CachedProcessMetrics>>> = OnceLock::new();

fn process_metrics_cache() -> &'static Mutex<HashMap<u32, CachedProcessMetrics>> {
    PROCESS_METRICS_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn encode_varint(value: i32) -> Vec<u8> {
    let mut encoded = Vec::new();
    let mut unsigned = value as u32;

    loop {
        let mut temp = (unsigned & 0b0111_1111) as u8;
        unsigned >>= 7;

        if unsigned != 0 {
            temp |= 0b1000_0000;
        }

        encoded.push(temp);

        if unsigned == 0 {
            break;
        }
    }

    encoded
}

fn read_varint_from_stream(stream: &mut TcpStream) -> Result<i32, String> {
    let mut result = 0_i32;
    let mut bytes_read = 0;

    loop {
        if bytes_read >= 5 {
            return Err("VarInt is too big.".to_string());
        }

        let mut byte = [0_u8; 1];
        stream.read_exact(&mut byte).map_err(|err| err.to_string())?;

        let value = i32::from(byte[0]);
        result |= (value & 0x7F) << (7 * bytes_read);
        bytes_read += 1;

        if (value & 0x80) == 0 {
            break;
        }
    }

    Ok(result)
}

fn read_varint_from_slice(data: &[u8], cursor: &mut usize) -> Result<i32, String> {
    let mut result = 0_i32;
    let mut bytes_read = 0;

    loop {
        if bytes_read >= 5 {
            return Err("VarInt is too big.".to_string());
        }

        let byte = *data
            .get(*cursor)
            .ok_or_else(|| "Unexpected end of packet while reading VarInt.".to_string())?;
        *cursor += 1;

        let value = i32::from(byte);
        result |= (value & 0x7F) << (7 * bytes_read);
        bytes_read += 1;

        if (value & 0x80) == 0 {
            break;
        }
    }

    Ok(result)
}

fn read_string_from_slice(data: &[u8], cursor: &mut usize) -> Result<String, String> {
    let length = read_varint_from_slice(data, cursor)?;
    if length < 0 {
        return Err("String length was negative.".to_string());
    }

    let length = usize::try_from(length).map_err(|_| "Invalid string length.".to_string())?;
    let end = cursor.saturating_add(length);
    let bytes = data
        .get(*cursor..end)
        .ok_or_else(|| "Unexpected end of packet while reading string.".to_string())?;
    *cursor = end;

    String::from_utf8(bytes.to_vec()).map_err(|err| err.to_string())
}

fn with_packet_length(payload: &[u8]) -> Vec<u8> {
    let mut packet = encode_varint(payload.len() as i32);
    packet.extend_from_slice(payload);
    packet
}

fn parse_number(value: &str) -> Option<f64> {
    let normalized = value.trim().replace(',', "");
    normalized.parse::<f64>().ok()
}

fn parse_u64(value: &str) -> Option<u64> {
    let normalized = value.trim().replace(',', "");
    normalized.parse::<u64>().ok()
}

fn clamp_percentage(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }

    value.max(0.0).min(100.0)
}

fn ram_percent_from_bytes(memory_bytes: u64, configured_ram_gb: Option<u32>) -> Option<f64> {
    let limit_gb = configured_ram_gb.filter(|value| *value > 0)?;
    let limit_bytes = u64::from(limit_gb).saturating_mul(1024 * 1024 * 1024);
    if limit_bytes == 0 {
        return None;
    }

    let percentage = (memory_bytes as f64 / limit_bytes as f64) * 100.0;
    Some(clamp_percentage(percentage))
}

pub(in crate::app) fn resolve_telemetry_target(config: &RuntimeServerConfig, directory: &std::path::Path) -> (String, u16) {
    let host = config
        .telemetry_host
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(default_telemetry_host);

    let port = config
        .telemetry_port
        .filter(|value| *value > 0)
        .unwrap_or_else(|| detect_default_telemetry_port(directory));

    (host, port)
}

pub(in crate::app) fn collect_status_ping(host: &str, port: u16, timeout: Duration) -> StatusPingResult {
    let query = || -> Result<StatusPingResult, String> {
        let address = format!("{host}:{port}");
        let socket_address = address
            .to_socket_addrs()
            .map_err(|err| err.to_string())?
            .next()
            .ok_or_else(|| "Could not resolve telemetry host.".to_string())?;

        let mut stream = TcpStream::connect_timeout(&socket_address, timeout).map_err(|err| err.to_string())?;
        stream
            .set_read_timeout(Some(timeout))
            .map_err(|err| err.to_string())?;
        stream
            .set_write_timeout(Some(timeout))
            .map_err(|err| err.to_string())?;

        let host_bytes = host.as_bytes();

        let mut handshake_payload = vec![0x00];
        handshake_payload.extend_from_slice(&encode_varint(754));
        handshake_payload.extend_from_slice(&encode_varint(host_bytes.len() as i32));
        handshake_payload.extend_from_slice(host_bytes);
        handshake_payload.extend_from_slice(&port.to_be_bytes());
        handshake_payload.extend_from_slice(&encode_varint(1));

        stream
            .write_all(&with_packet_length(&handshake_payload))
            .map_err(|err| err.to_string())?;

        let status_request_payload = [0x00_u8];
        stream
            .write_all(&with_packet_length(&status_request_payload))
            .map_err(|err| err.to_string())?;

        let packet_length = read_varint_from_stream(&mut stream)?;
        if packet_length <= 0 {
            return Err("Status packet was empty.".to_string());
        }

        let packet_length = usize::try_from(packet_length).map_err(|_| "Invalid packet length.".to_string())?;
        let mut packet = vec![0_u8; packet_length];
        stream.read_exact(&mut packet).map_err(|err| err.to_string())?;

        let mut cursor = 0_usize;
        let packet_id = read_varint_from_slice(&packet, &mut cursor)?;
        if packet_id != 0 {
            return Err("Unexpected packet id from status query.".to_string());
        }

        let response_json = read_string_from_slice(&packet, &mut cursor)?;
        let parsed: Value = serde_json::from_str(&response_json).map_err(|err| err.to_string())?;

        let players_online = parsed
            .pointer("/players/online")
            .and_then(|value| value.as_u64())
            .and_then(|value| u32::try_from(value).ok());
        let players_max = parsed
            .pointer("/players/max")
            .and_then(|value| value.as_u64())
            .and_then(|value| u32::try_from(value).ok());
        let server_version = parsed
            .pointer("/version/name")
            .and_then(|value| value.as_str())
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());

        Ok(StatusPingResult {
            online: true,
            players_online,
            players_max,
            server_version,
        })
    };

    query().unwrap_or_default()
}

fn normalize_provider_token(value: &str) -> Option<String> {
    let normalized = value.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }

    if normalized.contains("paper") {
        return Some("paper".to_string());
    }
    if normalized.contains("folia") {
        return Some("folia".to_string());
    }
    if normalized.contains("spigot") {
        return Some("spigot".to_string());
    }
    if normalized.contains("velocity") {
        return Some("velocity".to_string());
    }
    if normalized.contains("bungeecord") || normalized.contains("bungee") || normalized.contains("waterfall") {
        return Some("bungeecord".to_string());
    }
    if normalized.contains("vanilla") || normalized.contains("mojang") || normalized.contains("minecraft_server") {
        return Some("vanilla".to_string());
    }

    None
}

pub(in crate::app) fn infer_provider_version(config: &RuntimeServerConfig) -> Option<String> {
    if let Some(provider) = config
        .provider
        .as_deref()
        .and_then(normalize_provider_token)
    {
        return Some(provider);
    }

    if let Some(file_based) = infer_provider_from_jar_file(&config.file)
        .as_deref()
        .and_then(normalize_provider_token)
    {
        return Some(file_based);
    }

    if let Some(flags) = config.custom_flags.as_ref() {
        for flag in flags {
            if let Some(flag_based) = normalize_provider_token(flag) {
                return Some(flag_based);
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn collect_platform_process_metrics(pid: u32, configured_ram_gb: Option<u32>) -> ProcessMetricsResult {
    let script = format!(
        "$p = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter \"IDProcess = {pid}\"; if ($null -eq $p) {{ exit 1 }}; Write-Output $p.PercentProcessorTime; Write-Output $p.WorkingSet"
    );

    let output = match Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
    {
        Ok(value) => value,
        Err(_) => return ProcessMetricsResult::default(),
    };

    if !output.status.success() {
        return ProcessMetricsResult::default();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines().map(str::trim).filter(|line| !line.is_empty());

    let cpu_used = lines.next().and_then(parse_number).map(clamp_percentage);
    let ram_used = lines
        .next()
        .and_then(parse_u64)
        .and_then(|memory_bytes| ram_percent_from_bytes(memory_bytes, configured_ram_gb));

    ProcessMetricsResult { ram_used, cpu_used }
}

#[cfg(not(target_os = "windows"))]
fn collect_platform_process_metrics(pid: u32, configured_ram_gb: Option<u32>) -> ProcessMetricsResult {
    let output = match Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "%cpu=", "-o", "rss="])
        .output()
    {
        Ok(value) => value,
        Err(_) => return ProcessMetricsResult::default(),
    };

    if !output.status.success() {
        return ProcessMetricsResult::default();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut tokens = stdout.split_whitespace();

    let cpu_used = tokens.next().and_then(parse_number).map(clamp_percentage);
    let ram_used = tokens
        .next()
        .and_then(parse_u64)
        .map(|rss_kb| rss_kb.saturating_mul(1024))
        .and_then(|memory_bytes| ram_percent_from_bytes(memory_bytes, configured_ram_gb));

    ProcessMetricsResult { ram_used, cpu_used }
}

pub(in crate::app) fn collect_process_metrics(pid: u32, configured_ram_gb: Option<u32>) -> ProcessMetricsResult {
    collect_platform_process_metrics(pid, configured_ram_gb)
}

pub(in crate::app) fn clear_process_metrics_cache(pid: u32) {
    if let Ok(mut cache) = process_metrics_cache().lock() {
        cache.remove(&pid);
    }
}

pub(in crate::app) fn collect_process_metrics_cached(
    pid: u32,
    configured_ram_gb: Option<u32>,
    max_age: Duration,
) -> ProcessMetricsResult {
    if let Ok(cache) = process_metrics_cache().lock() {
        if let Some(cached) = cache.get(&pid) {
            if cached.measured_at.elapsed() <= max_age {
                return cached.metrics.clone();
            }
        }
    }

    let metrics = collect_process_metrics(pid, configured_ram_gb);

    if let Ok(mut cache) = process_metrics_cache().lock() {
        cache.insert(
            pid,
            CachedProcessMetrics {
                measured_at: Instant::now(),
                metrics: metrics.clone(),
            },
        );
    }

    metrics
}
