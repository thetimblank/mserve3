//! Minimal Source RCON client (the protocol vanilla Minecraft speaks), hand-rolled
//! to match the existing hand-rolled Server List Ping in `telemetry.rs` and avoid a
//! dependency. We only ever connect over loopback. Used for command execution and
//! reliable TPS retrieval (a real request/response instead of stdout scraping).

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

const TYPE_AUTH: i32 = 3;
const TYPE_EXEC: i32 = 2;
const PACKET_MIN_LEN: i32 = 10; // 4 (id) + 4 (type) + 0 (body) + 2 (terminators)
const PACKET_MAX_LEN: i32 = 8192;

pub(in crate::app) struct RconClient {
    stream: TcpStream,
    next_id: i32,
}

impl RconClient {
    pub(in crate::app) fn connect(
        host: &str,
        port: u16,
        password: &str,
        timeout: Duration,
    ) -> Result<Self, String> {
        let address = format!("{host}:{port}")
            .to_socket_addrs()
            .map_err(|err| err.to_string())?
            .next()
            .ok_or_else(|| "Could not resolve RCON host.".to_string())?;

        let stream = TcpStream::connect_timeout(&address, timeout).map_err(|err| err.to_string())?;
        stream
            .set_read_timeout(Some(timeout))
            .map_err(|err| err.to_string())?;
        stream
            .set_write_timeout(Some(timeout))
            .map_err(|err| err.to_string())?;

        let mut client = RconClient { stream, next_id: 1 };
        client.authenticate(password)?;
        Ok(client)
    }

    fn authenticate(&mut self, password: &str) -> Result<(), String> {
        let auth_id = self.send_packet(TYPE_AUTH, password)?;

        // Servers may emit a dummy SERVERDATA_RESPONSE_VALUE before the auth
        // response. Keep reading until we see an auth-type reply: id == -1 means
        // the password was rejected. Read timeouts bound the loop.
        for _ in 0..4 {
            let (response_id, response_type, _) = self.read_packet()?;
            if response_type == TYPE_EXEC || response_type == TYPE_AUTH {
                if response_id == -1 {
                    return Err("RCON authentication failed (bad password).".to_string());
                }
                if response_id == auth_id {
                    return Ok(());
                }
            }
        }

        Err("RCON authentication did not complete.".to_string())
    }

    /// Runs a command and returns the server's textual response body.
    pub(in crate::app) fn command(&mut self, command: &str) -> Result<String, String> {
        let request_id = self.send_packet(TYPE_EXEC, command)?;
        let (_, _, body) = self.read_packet()?;
        let _ = request_id;
        Ok(body)
    }

    fn send_packet(&mut self, packet_type: i32, body: &str) -> Result<i32, String> {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);

        let body_bytes = body.as_bytes();
        let length = (4 + 4 + body_bytes.len() + 2) as i32;

        let mut packet = Vec::with_capacity(4 + length as usize);
        packet.extend_from_slice(&length.to_le_bytes());
        packet.extend_from_slice(&id.to_le_bytes());
        packet.extend_from_slice(&packet_type.to_le_bytes());
        packet.extend_from_slice(body_bytes);
        packet.push(0);
        packet.push(0);

        self.stream
            .write_all(&packet)
            .map_err(|err| err.to_string())?;
        self.stream.flush().map_err(|err| err.to_string())?;
        Ok(id)
    }

    fn read_packet(&mut self) -> Result<(i32, i32, String), String> {
        let mut length_buf = [0u8; 4];
        self.stream
            .read_exact(&mut length_buf)
            .map_err(|err| err.to_string())?;
        let length = i32::from_le_bytes(length_buf);
        if !(PACKET_MIN_LEN..=PACKET_MAX_LEN).contains(&length) {
            return Err("RCON packet length out of range.".to_string());
        }

        let mut buffer = vec![0u8; length as usize];
        self.stream
            .read_exact(&mut buffer)
            .map_err(|err| err.to_string())?;

        let id = i32::from_le_bytes([buffer[0], buffer[1], buffer[2], buffer[3]]);
        let packet_type = i32::from_le_bytes([buffer[4], buffer[5], buffer[6], buffer[7]]);
        // Body sits between the header and the two trailing NUL terminators.
        let body_bytes = &buffer[8..buffer.len().saturating_sub(2)];
        let body = String::from_utf8_lossy(body_bytes).to_string();

        Ok((id, packet_type, body))
    }
}
