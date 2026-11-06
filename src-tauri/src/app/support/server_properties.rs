//! Reading and (idempotently) updating `server.properties`.
//!
//! The app owns the server files, so the most reliable way to get a universal
//! command/telemetry channel is to provision RCON ourselves: ensure
//! `enable-rcon=true`, a free `rcon.port`, and a strong random `rcon.password`.
//! The server binds RCON like its game port (`server-ip`, or all interfaces), so
//! the password is the only thing protecting it on the LAN. This replaces the old
//! approach of writing commands to stdin and scraping interleaved stdout.

use super::super::RconConfig;
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
            && found_key.trim().eq_ignore_ascii_case(key)
        {
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
        .is_some_and(|value| value.eq_ignore_ascii_case("true"));
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
        .is_some_and(|value| value.eq_ignore_ascii_case("true"));
    let broadcast_silenced = read_property(directory, "broadcast-rcon-to-ops")
        .is_some_and(|value| value.eq_ignore_ascii_case("false"));

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
pub(in crate::app) fn apply_properties(
    directory: &Path,
    updates: &[(&str, String)],
) -> Result<(), String> {
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
        .map_or(25575, |address| address.port())
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

/// Escapes a value for a `.properties` file the way Java's `Properties.store`
/// does, so the server reads back exactly `value`: backslashes and control
/// characters are escaped, a leading space survives as `\ `, and anything outside
/// printable ASCII becomes a `\uXXXX` escape (the server may read the file as
/// ISO-8859-1). This matches the MOTD editor, which stores `§` as `§`.
pub(in crate::app) fn escape_property_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for (index, ch) in value.chars().enumerate() {
        match ch {
            '\\' => out.push_str(r"\\"),
            '\n' => out.push_str(r"\n"),
            '\r' => out.push_str(r"\r"),
            '\t' => out.push_str(r"\t"),
            '\u{c}' => out.push_str(r"\f"),
            ' ' if index == 0 => out.push_str(r"\ "),
            ' '..='~' => out.push(ch),
            _ => {
                let mut units = [0u16; 2];
                for unit in ch.encode_utf16(&mut units) {
                    out.push_str(&format!(r"\u{unit:04X}"));
                }
            }
        }
    }
    out
}

/// Writes `motd=<motd>` when `server.properties` has no MOTD yet (no file, no
/// key, or an empty value). Creates the file if needed; the server fills in the
/// rest of its defaults on first launch. Returns whether anything was written.
pub(in crate::app) fn ensure_default_motd(directory: &Path, motd: &str) -> Result<bool, String> {
    if motd.trim().is_empty() {
        return Ok(false);
    }
    // A file we can't read as text (e.g. saved as ISO-8859-1 by another tool) is
    // left alone: rewriting it would drop every other setting in it.
    if let Err(err) = fs::read_to_string(properties_path(directory))
        && err.kind() != std::io::ErrorKind::NotFound
    {
        return Ok(false);
    }
    if read_property(directory, "motd").is_some() {
        return Ok(false);
    }
    apply_properties(directory, &[("motd", escape_property_value(motd))])?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_keeps_plain_ascii() {
        assert_eq!(escape_property_value("My Server 2"), "My Server 2");
    }

    #[test]
    fn escape_handles_backslash_leading_space_and_unicode() {
        assert_eq!(escape_property_value(r"a\b"), r"a\\b");
        assert_eq!(escape_property_value("  hi"), r"\  hi");
        assert_eq!(
            escape_property_value("\u{a7}aCaf\u{e9}"),
            format!("{}aCaf{}", unicode_escape("00A7"), unicode_escape("00E9"))
        );
        // Characters outside the BMP become a UTF-16 surrogate pair.
        assert_eq!(
            escape_property_value("\u{1F642}"),
            format!("{}{}", unicode_escape("D83D"), unicode_escape("DE42"))
        );
    }

    /// `\u` followed by `hex`, spelled out so the expectation stays readable.
    fn unicode_escape(hex: &str) -> String {
        format!(r"\u{hex}")
    }

    #[test]
    fn default_motd_creates_the_file_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(ensure_default_motd(dir.path(), "Survival").unwrap());
        assert_eq!(
            fs::read_to_string(dir.path().join("server.properties")).unwrap(),
            "motd=Survival\n"
        );
    }

    #[test]
    fn default_motd_never_replaces_an_existing_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("server.properties");
        fs::write(&path, "motd=Hello there\nserver-port=25570\n").unwrap();
        assert!(!ensure_default_motd(dir.path(), "Survival").unwrap());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "motd=Hello there\nserver-port=25570\n"
        );
    }

    #[test]
    fn default_motd_leaves_an_unreadable_file_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("server.properties");
        // ISO-8859-1 bytes (0xE9 = e-acute) are not valid UTF-8.
        let latin1 = b"server-port=25570\nlevel-name=Caf\xe9\n".to_vec();
        fs::write(&path, &latin1).unwrap();
        assert!(!ensure_default_motd(dir.path(), "Survival").unwrap());
        assert_eq!(fs::read(&path).unwrap(), latin1);
    }

    #[test]
    fn default_motd_fills_an_empty_value_and_keeps_other_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("server.properties");
        fs::write(&path, "# generated\nmotd=\nserver-port=25570\n").unwrap();
        assert!(ensure_default_motd(dir.path(), "Caf\u{e9}").unwrap());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            format!(
                "# generated\nmotd=Caf{}\nserver-port=25570\n",
                unicode_escape("00E9")
            )
        );
    }
}
