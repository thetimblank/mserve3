//! Reading and (idempotently) updating `server.properties`.
//!
//! The app owns the server files, so the most reliable way to get a universal
//! command/telemetry channel is to provision RCON ourselves: ensure
//! `enable-rcon=true`, a free `rcon.port`, and a strong random `rcon.password`.
//! We only ever connect to RCON over `127.0.0.1`. This replaces the old approach
//! of writing commands to stdin and scraping interleaved stdout.

use super::super::*;
use rand::Rng;
use std::collections::HashSet;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};

fn properties_path(directory: &Path) -> PathBuf {
    directory.join("server.properties")
}

/// Reads a single non-empty property value (trimmed) from `server.properties`.
pub(in crate::app) fn read_property(directory: &Path, key: &str) -> Option<String> {
    let raw = fs::read_to_string(properties_path(directory)).ok()?;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((found_key, value)) = trimmed.split_once('=')
            && found_key.trim().eq_ignore_ascii_case(key) {
                let value = value.trim();
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
    }
    None
}

/// Reads an already-provisioned RCON config from `server.properties` without
/// modifying anything. Used to adopt servers we did not start.
pub(in crate::app) fn read_rcon_config(directory: &Path) -> Option<RconConfig> {
    let enabled = read_property(directory, "enable-rcon")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if !enabled {
        return None;
    }
    let port = read_property(directory, "rcon.port")
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)?;
    let password = read_property(directory, "rcon.password").filter(|value| !value.is_empty())?;
    Some(RconConfig { port, password })
}

/// Ensures RCON is enabled with a port + password, reusing any existing valid
/// values and only writing when something is missing/incorrect. Returns the
/// effective config. The file is created if it does not exist yet (the server
/// fills in the remaining defaults on first launch).
pub(in crate::app) fn ensure_rcon_enabled(directory: &Path) -> Result<RconConfig, String> {
    let existing_port = read_property(directory, "rcon.port")
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0);
    let existing_password =
        read_property(directory, "rcon.password").filter(|value| !value.is_empty());
    let enabled = read_property(directory, "enable-rcon")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let broadcast_silenced = read_property(directory, "broadcast-rcon-to-ops")
        .map(|value| value.eq_ignore_ascii_case("false"))
        .unwrap_or(false);

    let port = existing_port.unwrap_or_else(free_loopback_port);
    let password = existing_password.clone().unwrap_or_else(generate_password);

    let needs_write =
        !enabled || existing_port.is_none() || existing_password.is_none() || !broadcast_silenced;

    if needs_write {
        let updates = [
            ("enable-rcon", "true".to_string()),
            ("rcon.port", port.to_string()),
            ("rcon.password", password.clone()),
            ("broadcast-rcon-to-ops", "false".to_string()),
        ];
        apply_properties(directory, &updates)?;
    }

    Ok(RconConfig { port, password })
}

/// Rewrites `server.properties` so each `(key, value)` is present exactly once,
/// preserving all other lines, comments, and ordering. Missing keys are appended.
fn apply_properties(directory: &Path, updates: &[(&str, String)]) -> Result<(), String> {
    let path = properties_path(directory);
    let existing = fs::read_to_string(&path).unwrap_or_default();

    let mut seen: HashSet<String> = HashSet::new();
    let mut out_lines: Vec<String> = Vec::new();

    for line in existing.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') || !trimmed.contains('=') {
            out_lines.push(line.to_string());
            continue;
        }
        let key = trimmed.split('=').next().unwrap_or("").trim();
        if let Some((update_key, value)) = updates.iter().find(|(k, _)| k.eq_ignore_ascii_case(key))
        {
            out_lines.push(format!("{update_key}={value}"));
            seen.insert(update_key.to_lowercase());
        } else {
            out_lines.push(line.to_string());
        }
    }

    for (key, value) in updates {
        if !seen.contains(&key.to_lowercase()) {
            out_lines.push(format!("{key}={value}"));
        }
    }

    let mut content = out_lines.join("\n");
    content.push('\n');
    fs::write(&path, content).map_err(|err| err.to_string())
}

/// Asks the OS for a free loopback TCP port by binding to port 0 and reading the
/// assignment back. There is a tiny race before the server claims it, which is
/// acceptable for a local-only RCON port.
fn free_loopback_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|address| address.port())
        .unwrap_or(25575)
}

/// Updates (or appends) the `server-port` key in `server.properties`.
pub(in crate::app) fn set_server_port(directory: &Path, port: u16) -> Result<(), String> {
    let updates = [("server-port", port.to_string())];
    apply_properties(directory, &updates)
}

fn generate_password() -> String {
    rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(24)
        .map(char::from)
        .collect()
}
