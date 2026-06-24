use super::super::*;
use super::mserve_config::{default_telemetry_host, detect_default_telemetry_port};
use super::rcon::RconClient;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Default)]
pub(in crate::app) struct StatusPingResult {
    pub online: bool,
    pub players_online: Option<u32>,
    pub players_max: Option<u32>,
    pub server_version: Option<String>,
}

#[derive(Default, Clone)]
pub(in crate::app) struct ProcessMetricsResult {
    pub ram_bytes: Option<u64>,
    pub ram_used: Option<f64>,
    pub cpu_used: Option<f64>,
}

// ---------------------------------------------------------------------------
// Server List Ping (the unauthenticated status protocol every Java server and
// proxy answers). Universal source for online/players/version.
// ---------------------------------------------------------------------------

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

fn clamp_percentage(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }

    value.max(0.0).min(100.0)
}

fn ram_percent_from_bytes(memory_bytes: u64, configured_ram_gb: Option<f64>) -> Option<f64> {
    let limit_gb = configured_ram_gb.filter(|value| value.is_finite() && *value > 0.0)?;
    let limit_bytes = limit_gb * (1024.0 * 1024.0 * 1024.0);
    if limit_bytes <= 0.0 {
        return None;
    }

    let percentage = (memory_bytes as f64 / limit_bytes) * 100.0;
    Some(clamp_percentage(percentage))
}

pub(in crate::app) fn resolve_telemetry_target(
    config: &RuntimeServerConfig,
    directory: &std::path::Path,
) -> (String, u16) {
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

/// Cheap "is the port accepting TCP connections" probe. This is the universal
/// signal that a server has finished loading and bound its port — it replaces
/// scraping the console for a provider-specific "Done (..)!" line.
pub(in crate::app) fn probe_port(host: &str, port: u16, timeout: Duration) -> bool {
    let Ok(mut addresses) = format!("{host}:{port}").to_socket_addrs() else {
        return false;
    };
    let Some(address) = addresses.next() else {
        return false;
    };
    TcpStream::connect_timeout(&address, timeout).is_ok()
}

pub(in crate::app) fn collect_status_ping(host: &str, port: u16, timeout: Duration) -> StatusPingResult {
    let query = || -> Result<StatusPingResult, String> {
        let address = format!("{host}:{port}");
        let socket_address = address
            .to_socket_addrs()
            .map_err(|err| err.to_string())?
            .next()
            .ok_or_else(|| "Could not resolve telemetry host.".to_string())?;

        let mut stream =
            TcpStream::connect_timeout(&socket_address, timeout).map_err(|err| err.to_string())?;
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

        let packet_length =
            usize::try_from(packet_length).map_err(|_| "Invalid packet length.".to_string())?;
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

pub(in crate::app) fn infer_provider_version(config: &RuntimeServerConfig) -> Option<String> {
    config.provider.as_ref().and_then(|provider| {
        let version = provider.provider_version.trim();
        if version.is_empty() {
            None
        } else {
            Some(version.to_string())
        }
    })
}

// ---------------------------------------------------------------------------
// Process metrics via sysinfo (cross-platform, no shell-out). The caller owns a
// persistent `System` so CPU% is accurate across refreshes.
// ---------------------------------------------------------------------------

pub(in crate::app) fn refresh_process_metrics(
    system: &mut System,
    pid: u32,
    configured_ram_gb: Option<f64>,
) -> ProcessMetricsResult {
    let pid = Pid::from_u32(pid);
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing().with_cpu().with_memory(),
    );

    let Some(process) = system.process(pid) else {
        return ProcessMetricsResult::default();
    };

    let ram_bytes = process.memory();
    let cpu_used = Some(clamp_percentage(process.cpu_usage() as f64));
    let ram_used = ram_percent_from_bytes(ram_bytes, configured_ram_gb);

    ProcessMetricsResult {
        ram_bytes: Some(ram_bytes),
        ram_used,
        cpu_used,
    }
}

// ---------------------------------------------------------------------------
// TPS via RCON. There is no external protocol that exposes TPS, so we ask the
// server itself through a real request/response channel. The exact command
// differs by server software, so we detect which one works once and cache it.
// ---------------------------------------------------------------------------

fn strip_minecraft_formatting(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{00a7}' {
            // Section sign: drop it and the following format code.
            chars.next();
            continue;
        }
        if ch == '\u{001b}' {
            // ANSI escape: skip until the terminating 'm'.
            while let Some(next) = chars.next() {
                if next == 'm' {
                    break;
                }
            }
            continue;
        }
        output.push(ch);
    }
    output
}

fn first_float_after(text: &str, needle: &str) -> Option<f64> {
    let lower = text.to_lowercase();
    let position = lower.find(&needle.to_lowercase())? + needle.len();
    let rest = text.get(position..)?;

    let mut number = String::new();
    let mut started = false;
    for ch in rest.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            number.push(ch);
            started = true;
        } else if started {
            break;
        }
    }

    number.parse::<f64>().ok()
}

/// Parses Paper/Spigot/Purpur `tps` output, e.g.
/// "TPS from last 1m, 5m, 15m: 20.0, 20.0, 19.9". Returns the 1-minute value.
fn parse_paper_tps(response: &str) -> Option<f64> {
    let cleaned = strip_minecraft_formatting(response);
    let value = first_float_after(&cleaned, "from last")?;
    Some(value.min(20.0))
}

/// Parses vanilla 1.21+ `tick query` output by deriving TPS from the average
/// milliseconds-per-tick line: tps = min(20, 1000 / mspt).
fn parse_tick_query_tps(response: &str) -> Option<f64> {
    let cleaned = strip_minecraft_formatting(response);
    let mspt = first_float_after(&cleaned, "Average time per tick:")?;
    if mspt <= 0.0 {
        return None;
    }
    Some((1000.0 / mspt).min(20.0))
}

pub(in crate::app) fn collect_tps_via_rcon(
    host: &str,
    rcon: &RconConfig,
    state: &mut TpsCommandState,
) -> Option<f64> {
    if matches!(state, TpsCommandState::Unsupported) {
        return None;
    }

    let mut client =
        match RconClient::connect(host, rcon.port, &rcon.password, Duration::from_millis(900)) {
            Ok(client) => client,
            // Transient connect failure: try again next cycle, don't give up.
            Err(_) => return None,
        };

    match *state {
        TpsCommandState::Paper => client.command("tps").ok().and_then(|r| parse_paper_tps(&r)),
        TpsCommandState::TickQuery => client
            .command("tick query")
            .ok()
            .and_then(|r| parse_tick_query_tps(&r)),
        TpsCommandState::Unknown => {
            if let Some(tps) = client.command("tps").ok().and_then(|r| parse_paper_tps(&r)) {
                *state = TpsCommandState::Paper;
                return Some(tps);
            }
            if let Some(tps) = client
                .command("tick query")
                .ok()
                .and_then(|r| parse_tick_query_tps(&r))
            {
                *state = TpsCommandState::TickQuery;
                return Some(tps);
            }
            *state = TpsCommandState::Unsupported;
            None
        }
        TpsCommandState::Unsupported => None,
    }
}
