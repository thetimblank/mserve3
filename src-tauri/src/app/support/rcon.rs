//! Minimal Source RCON client (the protocol vanilla Minecraft speaks), hand-rolled
//! to match the existing hand-rolled Server List Ping in `telemetry.rs` and avoid a
//! dependency. We connect to the server's telemetry host (loopback unless the
//! server pins `server-ip`). Used for command execution and reliable TPS
//! retrieval (a real request/response instead of stdout scraping).

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

const TYPE_AUTH: i32 = 3;
const TYPE_EXEC: i32 = 2;
const PACKET_MIN_LEN: i32 = 10; // 4 (id) + 4 (type) + 0 (body) + 2 (terminators)
/// Room for a full response fragment: 4096 UTF-16 units encode to at most
/// 4096 × 3 UTF-8 bytes, plus the 10-byte header/terminators.
const PACKET_MAX_LEN: i32 = 4096 * 3 + PACKET_MIN_LEN;
/// Minecraft splits a response body into packets of at most this many Java
/// `char`s (UTF-16 units), not bytes.
const RESPONSE_FRAGMENT_LEN: usize = 4096;
/// How long to wait for a follow-up fragment of a split response.
const FRAGMENT_WAIT: Duration = Duration::from_millis(150);
/// Upper bound on packets examined per command (stale leftovers + fragments).
const MAX_PACKETS_PER_COMMAND: usize = 64;

pub(in crate::app) struct RconClient {
    stream: TcpStream,
    next_id: i32,
    timeout: Duration,
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

        let stream =
            TcpStream::connect_timeout(&address, timeout).map_err(|err| err.to_string())?;
        stream
            .set_read_timeout(Some(timeout))
            .map_err(|err| err.to_string())?;
        stream
            .set_write_timeout(Some(timeout))
            .map_err(|err| err.to_string())?;

        let mut client = RconClient {
            stream,
            next_id: 1,
            timeout,
        };
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
    ///
    /// Packets carrying another request's id (leftovers of an earlier, split
    /// response) are skipped rather than mistaken for this reply. A body that
    /// fills a whole fragment may continue in follow-up packets, which are
    /// collected until the server goes quiet.
    pub(in crate::app) fn command(&mut self, command: &str) -> Result<String, String> {
        let request_id = self.send_packet(TYPE_EXEC, command)?;

        let mut body = None;
        for _ in 0..MAX_PACKETS_PER_COMMAND {
            let (id, _, fragment) = self.read_packet()?;
            if id == request_id {
                body = Some(fragment);
                break;
            }
        }
        let mut body = body.ok_or_else(|| "RCON response never arrived.".to_string())?;

        let mut last_fragment = body.encode_utf16().count();
        for _ in 0..MAX_PACKETS_PER_COMMAND {
            if last_fragment < RESPONSE_FRAGMENT_LEN || !self.next_packet_pending()? {
                break;
            }
            let (id, _, fragment) = self.read_packet()?;
            if id == request_id {
                last_fragment = fragment.encode_utf16().count();
                body.push_str(&fragment);
            }
        }

        Ok(body)
    }

    /// Waits briefly for the start of another packet without consuming any of
    /// it, so a timeout here can never leave a half-read packet in the stream.
    fn next_packet_pending(&mut self) -> Result<bool, String> {
        self.stream
            .set_read_timeout(Some(FRAGMENT_WAIT))
            .map_err(|err| err.to_string())?;
        let mut probe = [0u8; 1];
        let pending = matches!(self.stream.peek(&mut probe), Ok(n) if n > 0);
        self.stream
            .set_read_timeout(Some(self.timeout))
            .map_err(|err| err.to_string())?;
        Ok(pending)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::support::testkit::{FakeMinecraftServer, FakeServerConfig};

    const TIMEOUT: Duration = Duration::from_millis(800);

    #[test]
    fn authenticates_and_runs_a_command() {
        let server = FakeMinecraftServer::start(FakeServerConfig {
            tps_response: Some("pong-from-fake".to_string()),
            ..FakeServerConfig::default()
        });
        let mut client =
            RconClient::connect(&server.host, server.rcon_port.unwrap(), "secret", TIMEOUT)
                .unwrap();
        let response = client.command("tps").unwrap();
        assert_eq!(response, "pong-from-fake");
    }

    #[test]
    fn rejects_a_bad_password() {
        let server = FakeMinecraftServer::start(FakeServerConfig::default());
        let result = RconClient::connect(&server.host, server.rcon_port.unwrap(), "wrong", TIMEOUT);
        assert!(result.is_err());
    }

    /// Reads one client packet, returning its id.
    fn read_request(stream: &mut TcpStream) -> i32 {
        let mut len = [0u8; 4];
        stream.read_exact(&mut len).unwrap();
        let mut buf = vec![0u8; i32::from_le_bytes(len) as usize];
        stream.read_exact(&mut buf).unwrap();
        i32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]])
    }

    /// Writes one server packet. Type 2 doubles as the auth-response type; the
    /// client ignores the type for command replies.
    fn write_response(stream: &mut TcpStream, id: i32, body: &str) {
        let length = (4 + 4 + body.len() + 2) as i32;
        let mut packet = length.to_le_bytes().to_vec();
        packet.extend_from_slice(&id.to_le_bytes());
        packet.extend_from_slice(&2_i32.to_le_bytes());
        packet.extend_from_slice(body.as_bytes());
        packet.extend_from_slice(&[0, 0]);
        stream.write_all(&packet).unwrap();
    }

    /// A one-connection RCON server that accepts any password, then hands the
    /// first command's id to `reply` to script the response packets.
    fn scripted_server(reply: impl FnOnce(&mut TcpStream, i32) + Send + 'static) -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let auth_id = read_request(&mut stream);
            write_response(&mut stream, auth_id, "");
            let command_id = read_request(&mut stream);
            reply(&mut stream, command_id);
            // Hold the socket open so the client's fragment wait times out
            // rather than seeing EOF.
            std::thread::sleep(Duration::from_millis(500));
        });
        port
    }

    #[test]
    fn stale_packets_from_another_request_are_skipped() {
        // Regression (R-036): the client used to take whatever packet arrived
        // next, so leftovers of an earlier split response desynced it.
        let port = scripted_server(|stream, command_id| {
            write_response(stream, command_id - 1, "stale fragment");
            write_response(stream, command_id, "fresh reply");
        });
        let mut client = RconClient::connect("127.0.0.1", port, "pw", TIMEOUT).unwrap();
        assert_eq!(client.command("list").unwrap(), "fresh reply");
    }

    #[test]
    fn split_responses_are_reassembled() {
        // A 4096-char fragment signals more to come; multi-byte chars push it
        // past 8 KiB on the wire, which the old length cap rejected outright.
        let first = "é".repeat(RESPONSE_FRAGMENT_LEN);
        let expected = format!("{first}tail");
        let port = scripted_server(move |stream, command_id| {
            write_response(stream, command_id, &first);
            write_response(stream, command_id, "tail");
        });
        let mut client = RconClient::connect("127.0.0.1", port, "pw", TIMEOUT).unwrap();
        assert_eq!(client.command("help").unwrap(), expected);
    }

    #[test]
    fn unknown_command_yields_empty_body() {
        let server = FakeMinecraftServer::start(FakeServerConfig::default());
        let mut client =
            RconClient::connect(&server.host, server.rcon_port.unwrap(), "secret", TIMEOUT)
                .unwrap();
        // The fake server only knows `tps`; anything else returns an empty body.
        assert_eq!(client.command("seed").unwrap(), "");
    }
}
