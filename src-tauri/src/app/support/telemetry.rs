use super::super::{RconConfig, RuntimeServerConfig, TpsCommandState};
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
        stream
            .read_exact(&mut byte)
            .map_err(|err| err.to_string())?;

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

    value.clamp(0.0, 100.0)
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
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map_or_else(default_telemetry_host, std::string::ToString::to_string);

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

pub(in crate::app) fn collect_status_ping(
    host: &str,
    port: u16,
    timeout: Duration,
) -> StatusPingResult {
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
        stream
            .read_exact(&mut packet)
            .map_err(|err| err.to_string())?;

        let mut cursor = 0_usize;
        let packet_id = read_varint_from_slice(&packet, &mut cursor)?;
        if packet_id != 0 {
            return Err("Unexpected packet id from status query.".to_string());
        }

        let response_json = read_string_from_slice(&packet, &mut cursor)?;
        let parsed: Value = serde_json::from_str(&response_json).map_err(|err| err.to_string())?;

        let players_online = parsed
            .pointer("/players/online")
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok());
        let players_max = parsed
            .pointer("/players/max")
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok());
        let server_version = parsed
            .pointer("/version/name")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(std::string::ToString::to_string);

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

/// Walks parent links to decide whether `pid` is `root` or a descendant of it.
/// Capped so a malformed/cyclic parent chain can never loop forever.
fn is_in_subtree(system: &System, pid: Pid, root: Pid) -> bool {
    if pid == root {
        return true;
    }
    let mut current = pid;
    for _ in 0..64 {
        let Some(process) = system.process(current) else {
            return false;
        };
        let Some(parent) = process.parent() else {
            return false;
        };
        if parent == root {
            return true;
        }
        current = parent;
    }
    false
}

pub(in crate::app) fn refresh_process_metrics(
    system: &mut System,
    pid: u32,
    configured_ram_gb: Option<f64>,
) -> ProcessMetricsResult {
    let root = Pid::from_u32(pid);
    // Refresh every process (not just `root`) so we can sum the whole subtree.
    // Some server jars (modern bundlers/launchers) run as a small bootstrap that
    // spawns the real JVM as a child, so the heap-holding process is often a
    // descendant of the PID we spawned, not the PID itself. Summing the subtree
    // gives the true memory/CPU regardless of how the server chose to launch.
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cpu().with_memory(),
    );

    if system.process(root).is_none() {
        return ProcessMetricsResult::default();
    }

    let pids: Vec<Pid> = system.processes().keys().copied().collect();
    let mut ram_bytes: u64 = 0;
    let mut cpu_total: f64 = 0.0;
    for pid in pids {
        if !is_in_subtree(system, pid, root) {
            continue;
        }
        if let Some(process) = system.process(pid) {
            ram_bytes = ram_bytes.saturating_add(process.memory());
            cpu_total += f64::from(process.cpu_usage());
        }
    }

    let cpu_used = Some(clamp_percentage(cpu_total));
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
            for next in chars.by_ref() {
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

/// First decimal number appearing in `text` (e.g. "  20.0, 19.9" -> 20.0).
fn first_float_in(text: &str) -> Option<f64> {
    let mut number = String::new();
    let mut started = false;
    for ch in text.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            number.push(ch);
            started = true;
        } else if started {
            break;
        }
    }
    number.parse::<f64>().ok()
}

fn first_float_after(text: &str, needle: &str) -> Option<f64> {
    let lower = text.to_lowercase();
    let position = lower.find(&needle.to_lowercase())? + needle.len();
    first_float_in(text.get(position..)?)
}

/// Parses Paper/Spigot/Purpur/Folia `tps` output, e.g.
/// "TPS from last 1m, 5m, 15m: 20.0, 20.0, 19.9". Returns the first (shortest
/// window) value. The numbers come *after* the colon — we must not read the
/// interval labels ("1m", "5m") which precede it, or every server reads as 1 TPS.
fn parse_paper_tps(response: &str) -> Option<f64> {
    let cleaned = strip_minecraft_formatting(response);
    let lower = cleaned.to_lowercase();
    let from_last = lower.find("from last")?;
    let colon_rel = cleaned.get(from_last..)?.find(':')?;
    let after = cleaned.get(from_last + colon_rel + 1..)?;
    let value = first_float_in(after)?;
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

const RCON_TIMEOUT: Duration = Duration::from_millis(900);

/// Runs `command` on the persistent RCON client, lazily (re)connecting. If the
/// connection is missing or the server closed it after a previous command (some
/// servers do this), it reconnects once and retries. Returns `None` only on a
/// genuine connection failure — never conflate "can't reach RCON right now" with
/// "this command is unsupported", or detection will give up prematurely.
fn rcon_run(
    host: &str,
    rcon: &RconConfig,
    client_slot: &mut Option<RconClient>,
    command: &str,
) -> Option<String> {
    for _ in 0..2 {
        if client_slot.is_none() {
            match RconClient::connect(host, rcon.port, &rcon.password, RCON_TIMEOUT) {
                Ok(client) => *client_slot = Some(client),
                Err(_) => return None,
            }
        }
        match client_slot
            .as_mut()
            .and_then(|client| client.command(command).ok())
        {
            Some(response) => return Some(response),
            // Connection went away mid-command: drop it and retry once fresh.
            None => *client_slot = None,
        }
    }
    None
}

/// Retrieves TPS over RCON, reusing a persistent connection (`client_slot`) to
/// avoid reconnecting every poll. The command differs by server software, so we
/// detect which one works once and cache it. Each detection probe uses
/// `rcon_run`'s reconnect-once behavior so a server that closes the socket after
/// the first command can't make us wrongly conclude TPS is unsupported.
pub(in crate::app) fn collect_tps_via_rcon(
    host: &str,
    rcon: &RconConfig,
    state: &mut TpsCommandState,
    client_slot: &mut Option<RconClient>,
) -> Option<f64> {
    match *state {
        TpsCommandState::Unsupported => None,
        TpsCommandState::Paper => {
            rcon_run(host, rcon, client_slot, "tps").and_then(|r| parse_paper_tps(&r))
        }
        TpsCommandState::TickQuery => {
            rcon_run(host, rcon, client_slot, "tick query").and_then(|r| parse_tick_query_tps(&r))
        }
        TpsCommandState::Unknown => {
            // Paper/Spigot/Folia style first.
            {
                let response = rcon_run(host, rcon, client_slot, "tps")?;
                if let Some(tps) = parse_paper_tps(&response) {
                    *state = TpsCommandState::Paper;
                    return Some(tps);
                }
            }
            // Vanilla 1.21+ `tick query` style next.
            {
                let response = rcon_run(host, rcon, client_slot, "tick query")?;
                if let Some(tps) = parse_tick_query_tps(&response) {
                    *state = TpsCommandState::TickQuery;
                    return Some(tps);
                }
            }
            // Both commands reached the server and neither yields TPS (e.g. old
            // vanilla, which has no TPS command at all).
            *state = TpsCommandState::Unsupported;
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- VarInt codec (Minecraft's variable-length integers) ---

    #[test]
    fn varint_roundtrips_known_values() {
        // Reference encodings from the Minecraft protocol spec.
        assert_eq!(encode_varint(0), vec![0x00]);
        assert_eq!(encode_varint(1), vec![0x01]);
        assert_eq!(encode_varint(127), vec![0x7f]);
        assert_eq!(encode_varint(128), vec![0x80, 0x01]);
        assert_eq!(encode_varint(255), vec![0xff, 0x01]);
        assert_eq!(encode_varint(25565), vec![0xdd, 0xc7, 0x01]);
    }

    #[test]
    fn varint_decodes_what_it_encodes() {
        for value in [0, 1, 127, 128, 300, 25565, 2_097_151, i32::MAX] {
            let encoded = encode_varint(value);
            let mut cursor = 0usize;
            assert_eq!(
                read_varint_from_slice(&encoded, &mut cursor).unwrap(),
                value
            );
            assert_eq!(cursor, encoded.len());
        }
    }

    #[test]
    fn varint_rejects_overlong_sequence() {
        // Five continuation bytes with the high bit always set is too long.
        let data = [0x80, 0x80, 0x80, 0x80, 0x80, 0x01];
        let mut cursor = 0usize;
        assert!(read_varint_from_slice(&data, &mut cursor).is_err());
    }

    #[test]
    fn varint_errors_on_truncated_input() {
        let data = [0x80]; // continuation bit set but no following byte
        let mut cursor = 0usize;
        assert!(read_varint_from_slice(&data, &mut cursor).is_err());
    }

    // --- length-prefixed strings ---

    #[test]
    fn reads_length_prefixed_string() {
        let mut data = encode_varint("hi".len() as i32);
        data.extend_from_slice(b"hi");
        let mut cursor = 0usize;
        assert_eq!(read_string_from_slice(&data, &mut cursor).unwrap(), "hi");
        assert_eq!(cursor, data.len());
    }

    #[test]
    fn string_read_errors_when_body_truncated() {
        let mut data = encode_varint(10); // claims 10 bytes...
        data.extend_from_slice(b"abc"); // ...but only 3 follow
        let mut cursor = 0usize;
        assert!(read_string_from_slice(&data, &mut cursor).is_err());
    }

    // --- Minecraft formatting stripping ---

    #[test]
    fn strips_section_sign_codes() {
        assert_eq!(
            strip_minecraft_formatting("\u{00a7}aGreen\u{00a7}r"),
            "Green"
        );
    }

    #[test]
    fn strips_ansi_escape_sequences() {
        assert_eq!(
            strip_minecraft_formatting("\u{001b}[32mTPS\u{001b}[0m"),
            "TPS"
        );
    }

    // --- float extraction ---

    #[test]
    fn first_float_in_reads_leading_number() {
        assert_eq!(first_float_in("  20.0, 19.9"), Some(20.0));
        assert_eq!(first_float_in("abc 5.5"), Some(5.5));
        assert_eq!(first_float_in("no number"), None);
    }

    #[test]
    fn first_float_after_needle() {
        assert_eq!(first_float_after("foo: 12.3 bar", "foo:"), Some(12.3));
        assert_eq!(first_float_after("nothing here", "missing"), None);
    }

    // --- TPS parsing (the bug-prone bit: must read AFTER the colon) ---

    #[test]
    fn parses_paper_tps_first_window() {
        let response = "TPS from last 1m, 5m, 15m: 20.0, 20.0, 19.9";
        assert_eq!(parse_paper_tps(response), Some(20.0));
    }

    #[test]
    fn paper_tps_ignores_interval_labels_before_colon() {
        // Regression guard: the "1m, 5m, 15m" labels precede the colon. Reading a
        // number before the colon would make every server report ~1 TPS.
        let response = "§6TPS from last 1m, 5m, 15m:§a 19.5, 20.0, 20.0";
        assert_eq!(parse_paper_tps(response), Some(19.5));
    }

    #[test]
    fn paper_tps_is_clamped_to_20() {
        // Some forks momentarily report >20; we cap it.
        let response = "TPS from last 1m: 21.4";
        assert_eq!(parse_paper_tps(response), Some(20.0));
    }

    #[test]
    fn paper_tps_returns_none_without_marker() {
        assert_eq!(parse_paper_tps("Unknown command"), None);
    }

    #[test]
    fn parses_tick_query_tps_from_mspt() {
        // 50 ms/tick -> 1000/50 = 20 TPS.
        let response = "Target tick rate: 20.0 per second.\nAverage time per tick: 50.0 ms";
        assert_eq!(parse_tick_query_tps(response), Some(20.0));
    }

    #[test]
    fn tick_query_tps_derived_below_20_when_slow() {
        // 100 ms/tick -> 10 TPS.
        let response = "Average time per tick: 100.0 ms";
        assert_eq!(parse_tick_query_tps(response), Some(10.0));
    }

    #[test]
    fn tick_query_tps_handles_zero_mspt() {
        let response = "Average time per tick: 0.0 ms";
        assert_eq!(parse_tick_query_tps(response), None);
    }

    // --- RAM percentage ---

    #[test]
    fn ram_percent_of_configured_heap() {
        // 1 GiB used of a 2 GiB heap -> 50%.
        let one_gib = 1024u64 * 1024 * 1024;
        let pct = ram_percent_from_bytes(one_gib, Some(2.0)).unwrap();
        assert!((pct - 50.0).abs() < 0.01, "got {pct}");
    }

    #[test]
    fn ram_percent_clamps_and_guards_bad_limits() {
        // Over the limit clamps to 100.
        let huge = 100u64 * 1024 * 1024 * 1024;
        assert_eq!(ram_percent_from_bytes(huge, Some(1.0)), Some(100.0));
        // Non-positive / missing limits yield None rather than dividing by zero.
        assert_eq!(ram_percent_from_bytes(1024, Some(0.0)), None);
        assert_eq!(ram_percent_from_bytes(1024, None), None);
    }

    // --- SLP status JSON parsing (via collect_status_ping's parser) ---
    // The JSON-shape parsing is exercised end-to-end through the fake server in
    // the integration tests below.
}

/// L3 integration: the telemetry pipeline (probe → SLP → RCON TPS) driven against
/// the in-process fake Minecraft server. No JVM, deterministic, runs in ms.
#[cfg(test)]
mod pipeline_tests {
    use super::{collect_status_ping, collect_tps_via_rcon, probe_port};
    use crate::app::RconConfig;
    use crate::app::TpsCommandState;
    use crate::app::support::testkit::{FakeMinecraftServer, FakeServerConfig};
    use std::net::TcpListener;
    use std::time::Duration;

    const TIMEOUT: Duration = Duration::from_millis(800);

    #[test]
    fn probe_detects_a_listening_port() {
        let server = FakeMinecraftServer::start(FakeServerConfig::default());
        assert!(probe_port(&server.host, server.game_port, TIMEOUT));
    }

    #[test]
    fn probe_is_false_for_a_closed_port() {
        // Bind then immediately drop to obtain a port nothing is listening on.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        assert!(!probe_port("127.0.0.1", port, Duration::from_millis(300)));
    }

    #[test]
    fn slp_reports_players_and_version() {
        let server = FakeMinecraftServer::start(FakeServerConfig {
            players_online: 3,
            players_max: 20,
            version: "1.21.1".to_string(),
            ..FakeServerConfig::default()
        });
        let status = collect_status_ping(&server.host, server.game_port, TIMEOUT);
        assert!(status.online);
        assert_eq!(status.players_online, Some(3));
        assert_eq!(status.players_max, Some(20));
        assert_eq!(status.server_version.as_deref(), Some("1.21.1"));
    }

    #[test]
    fn slp_against_dead_port_is_offline_default() {
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let status = collect_status_ping("127.0.0.1", port, Duration::from_millis(300));
        assert!(!status.online);
        assert_eq!(status.players_online, None);
    }

    #[test]
    fn tps_via_rcon_paper_path_and_caches_state() {
        let server = FakeMinecraftServer::start(FakeServerConfig {
            tps_response: Some("TPS from last 1m, 5m, 15m: 19.5, 20.0, 20.0".to_string()),
            ..FakeServerConfig::default()
        });
        let rcon = RconConfig {
            port: server.rcon_port.unwrap(),
            password: "secret".to_string(),
        };
        let mut state = TpsCommandState::Unknown;
        let mut client = None;

        let tps = collect_tps_via_rcon(&server.host, &rcon, &mut state, &mut client);
        assert_eq!(tps, Some(19.5));
        // Detection is cached after the first success.
        assert_eq!(state, TpsCommandState::Paper);
    }

    #[test]
    fn tps_via_rcon_falls_through_to_tick_query() {
        let server = FakeMinecraftServer::start(FakeServerConfig {
            tps_response: None, // no Paper `tps` command
            tick_query_response: Some("Average time per tick: 50.0 ms".to_string()),
            ..FakeServerConfig::default()
        });
        let rcon = RconConfig {
            port: server.rcon_port.unwrap(),
            password: "secret".to_string(),
        };
        let mut state = TpsCommandState::Unknown;
        let mut client = None;

        let tps = collect_tps_via_rcon(&server.host, &rcon, &mut state, &mut client);
        assert_eq!(tps, Some(20.0));
        assert_eq!(state, TpsCommandState::TickQuery);
    }

    #[test]
    fn tps_via_rcon_marks_unsupported_when_no_command_works() {
        let server = FakeMinecraftServer::start(FakeServerConfig {
            tps_response: None,
            tick_query_response: None,
            ..FakeServerConfig::default()
        });
        let rcon = RconConfig {
            port: server.rcon_port.unwrap(),
            password: "secret".to_string(),
        };
        let mut state = TpsCommandState::Unknown;
        let mut client = None;

        let tps = collect_tps_via_rcon(&server.host, &rcon, &mut state, &mut client);
        assert_eq!(tps, None);
        assert_eq!(state, TpsCommandState::Unsupported);
    }
}
