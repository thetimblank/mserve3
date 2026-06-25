//! Test-only fake Minecraft server. Speaks just enough of the Server List Ping
//! and Source RCON protocols to drive the telemetry pipeline (probe → SLP →
//! RCON TPS) deterministically, without a JVM or a real server jar.
//!
//! Bound to loopback on an ephemeral port. Handler threads are detached and idle
//! on a blocking `accept()` for the (short) lifetime of the test process.
#![cfg(test)]
#![allow(dead_code)]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

/// How the fake server should behave for a single test.
#[derive(Clone)]
pub(in crate::app) struct FakeServerConfig {
    pub players_online: u32,
    pub players_max: u32,
    pub version: String,
    /// `None` makes the server proxy-like: it answers SLP but exposes no RCON.
    pub rcon_password: Option<String>,
    /// Reply to the Paper-style `tps` command, if any.
    pub tps_response: Option<String>,
    /// Reply to the vanilla `tick query` command, if any.
    pub tick_query_response: Option<String>,
}

impl Default for FakeServerConfig {
    fn default() -> Self {
        FakeServerConfig {
            players_online: 0,
            players_max: 20,
            version: "1.21".to_string(),
            rcon_password: Some("secret".to_string()),
            tps_response: Some("TPS from last 1m, 5m, 15m: 20.0, 20.0, 19.9".to_string()),
            tick_query_response: None,
        }
    }
}

pub(in crate::app) struct FakeMinecraftServer {
    pub host: String,
    pub game_port: u16,
    pub rcon_port: Option<u16>,
}

impl FakeMinecraftServer {
    pub(in crate::app) fn start(config: FakeServerConfig) -> Self {
        let game_listener = TcpListener::bind("127.0.0.1:0").expect("bind game port");
        let game_port = game_listener.local_addr().unwrap().port();

        let slp_json = build_status_json(&config);
        thread::spawn(move || {
            for stream in game_listener.incoming() {
                let Ok(stream) = stream else { continue };
                let json = slp_json.clone();
                thread::spawn(move || handle_slp(stream, &json));
            }
        });

        let rcon_port = config.rcon_password.as_ref().map(|password| {
            let rcon_listener = TcpListener::bind("127.0.0.1:0").expect("bind rcon port");
            let port = rcon_listener.local_addr().unwrap().port();
            let password = password.clone();
            let mut commands: HashMap<String, String> = HashMap::new();
            if let Some(tps) = config.tps_response.clone() {
                commands.insert("tps".to_string(), tps);
            }
            if let Some(tick) = config.tick_query_response.clone() {
                commands.insert("tick query".to_string(), tick);
            }
            thread::spawn(move || {
                for stream in rcon_listener.incoming() {
                    let Ok(stream) = stream else { continue };
                    let password = password.clone();
                    let commands = commands.clone();
                    thread::spawn(move || handle_rcon(stream, &password, &commands));
                }
            });
            port
        });

        FakeMinecraftServer {
            host: "127.0.0.1".to_string(),
            game_port,
            rcon_port,
        }
    }
}

fn build_status_json(config: &FakeServerConfig) -> String {
    format!(
        r#"{{"version":{{"name":"{}","protocol":754}},"players":{{"online":{},"max":{}}},"description":"fake"}}"#,
        config.version, config.players_online, config.players_max
    )
}

// --- minimal SLP server side (mirror of telemetry.rs's client) ---

fn encode_varint(value: i32) -> Vec<u8> {
    let mut out = Vec::new();
    let mut unsigned = value as u32;
    loop {
        let mut byte = (unsigned & 0x7F) as u8;
        unsigned >>= 7;
        if unsigned != 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if unsigned == 0 {
            break;
        }
    }
    out
}

fn read_varint(stream: &mut TcpStream) -> Option<i32> {
    let mut result = 0_i32;
    let mut shift = 0;
    loop {
        if shift >= 35 {
            return None;
        }
        let mut byte = [0u8; 1];
        stream.read_exact(&mut byte).ok()?;
        result |= ((byte[0] & 0x7F) as i32) << shift;
        if byte[0] & 0x80 == 0 {
            return Some(result);
        }
        shift += 7;
    }
}

fn read_n(stream: &mut TcpStream, n: usize) -> Option<Vec<u8>> {
    let mut buf = vec![0u8; n];
    stream.read_exact(&mut buf).ok()?;
    Some(buf)
}

fn handle_slp(mut stream: TcpStream, json: &str) {
    // Handshake packet (length-prefixed) — read and discard.
    let Some(len) = read_varint(&mut stream) else {
        return;
    };
    if len < 0 || read_n(&mut stream, len as usize).is_none() {
        return;
    }
    // Status request packet — read and discard.
    let Some(len) = read_varint(&mut stream) else {
        return;
    };
    if len < 0 || read_n(&mut stream, len as usize).is_none() {
        return;
    }

    // Status response: [packet_id=0][varint(json_len)][json].
    let mut payload = vec![0x00u8];
    payload.extend_from_slice(&encode_varint(json.len() as i32));
    payload.extend_from_slice(json.as_bytes());

    let mut packet = encode_varint(payload.len() as i32);
    packet.extend_from_slice(&payload);
    let _ = stream.write_all(&packet);
    let _ = stream.flush();
}

// --- minimal Source RCON server side (mirror of rcon.rs's client) ---

const RCON_AUTH: i32 = 3;
const RCON_EXEC: i32 = 2;
const RCON_RESPONSE: i32 = 0;
const RCON_AUTH_RESPONSE: i32 = 2;

fn write_rcon_packet(stream: &mut TcpStream, id: i32, packet_type: i32, body: &str) {
    let body_bytes = body.as_bytes();
    let length = (4 + 4 + body_bytes.len() + 2) as i32;
    let mut packet = Vec::with_capacity(4 + length as usize);
    packet.extend_from_slice(&length.to_le_bytes());
    packet.extend_from_slice(&id.to_le_bytes());
    packet.extend_from_slice(&packet_type.to_le_bytes());
    packet.extend_from_slice(body_bytes);
    packet.push(0);
    packet.push(0);
    let _ = stream.write_all(&packet);
    let _ = stream.flush();
}

fn handle_rcon(mut stream: TcpStream, password: &str, commands: &HashMap<String, String>) {
    loop {
        let mut length_buf = [0u8; 4];
        if stream.read_exact(&mut length_buf).is_err() {
            return;
        }
        let length = i32::from_le_bytes(length_buf);
        if !(10..=8192).contains(&length) {
            return;
        }
        let Some(buf) = read_n(&mut stream, length as usize) else {
            return;
        };
        let id = i32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
        let packet_type = i32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]);
        let body = String::from_utf8_lossy(&buf[8..buf.len().saturating_sub(2)]).to_string();

        match packet_type {
            RCON_AUTH => {
                let reply_id = if body == password { id } else { -1 };
                write_rcon_packet(&mut stream, reply_id, RCON_AUTH_RESPONSE, "");
            }
            RCON_EXEC => {
                let response = commands.get(body.as_str()).cloned().unwrap_or_default();
                write_rcon_packet(&mut stream, id, RCON_RESPONSE, &response);
            }
            _ => return,
        }
    }
}
