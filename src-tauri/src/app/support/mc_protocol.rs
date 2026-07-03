//! Minimal Minecraft Java-edition protocol codec shared by the Server-List-Ping
//! telemetry probe and the sleep-mode wake listener. Only the handful of packets
//! those two need are implemented: VarInt/String framing, the client handshake,
//! the status response, and a login disconnect.
//!
//! std-only (no async, no external crates) so it compiles identically on Windows
//! and Linux.

use std::io::Read;
use std::net::TcpStream;

/// Encodes a Minecraft protocol VarInt.
pub(in crate::app) fn encode_varint(value: i32) -> Vec<u8> {
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

/// Decodes a VarInt by pulling one byte at a time from `next_byte`, so the same
/// logic serves both a live TCP stream and an in-memory packet slice.
fn read_varint(mut next_byte: impl FnMut() -> Result<u8, String>) -> Result<i32, String> {
    let mut result = 0_i32;
    let mut bytes_read = 0;

    loop {
        if bytes_read >= 5 {
            return Err("VarInt is too big.".to_string());
        }

        let value = i32::from(next_byte()?);
        result |= (value & 0x7F) << (7 * bytes_read);
        bytes_read += 1;

        if (value & 0x80) == 0 {
            break;
        }
    }

    Ok(result)
}

pub(in crate::app) fn read_varint_from_stream(stream: &mut TcpStream) -> Result<i32, String> {
    read_varint(|| {
        let mut byte = [0_u8; 1];
        stream
            .read_exact(&mut byte)
            .map_err(|err| err.to_string())?;
        Ok(byte[0])
    })
}

pub(in crate::app) fn read_varint_from_slice(
    data: &[u8],
    cursor: &mut usize,
) -> Result<i32, String> {
    read_varint(|| {
        let byte = *data
            .get(*cursor)
            .ok_or_else(|| "Unexpected end of packet while reading VarInt.".to_string())?;
        *cursor += 1;
        Ok(byte)
    })
}

pub(in crate::app) fn read_string_from_slice(
    data: &[u8],
    cursor: &mut usize,
) -> Result<String, String> {
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

/// Prefixes a packet payload with its VarInt length (the Minecraft framing).
pub(in crate::app) fn with_packet_length(payload: &[u8]) -> Vec<u8> {
    let mut packet = encode_varint(payload.len() as i32);
    packet.extend_from_slice(payload);
    packet
}

/// Encodes a Minecraft protocol String (VarInt length prefix + UTF-8 bytes).
fn encode_string(value: &str) -> Vec<u8> {
    let bytes = value.as_bytes();
    let mut encoded = encode_varint(bytes.len() as i32);
    encoded.extend_from_slice(bytes);
    encoded
}

/// The client's opening handshake: which protocol version it speaks and what it
/// wants next (1 = status/ping, 2 = login, 3 = transfer).
pub(in crate::app) struct Handshake {
    pub protocol_version: i32,
    pub next_state: i32,
}

/// Reads one length-prefixed handshake packet from a freshly-accepted client.
/// Layout: [len][packetId=0x00][protocolVersion VarInt][serverAddress String]
/// [serverPort u16][nextState VarInt].
pub(in crate::app) fn read_handshake(stream: &mut TcpStream) -> Result<Handshake, String> {
    let packet_length = read_varint_from_stream(stream)?;
    let packet_length =
        usize::try_from(packet_length).map_err(|_| "Invalid handshake length.".to_string())?;
    // Guard against a hostile/oversized frame.
    if packet_length == 0 || packet_length > 1024 {
        return Err("Unexpected handshake packet size.".to_string());
    }

    let mut packet = vec![0_u8; packet_length];
    stream
        .read_exact(&mut packet)
        .map_err(|err| err.to_string())?;

    let mut cursor = 0_usize;
    let packet_id = read_varint_from_slice(&packet, &mut cursor)?;
    if packet_id != 0x00 {
        return Err(format!("Unexpected handshake packet id: {packet_id}."));
    }

    let protocol_version = read_varint_from_slice(&packet, &mut cursor)?;
    let _server_address = read_string_from_slice(&packet, &mut cursor)?;
    // Server port: two big-endian bytes we don't need but must skip.
    cursor = cursor.saturating_add(2);
    let next_state = read_varint_from_slice(&packet, &mut cursor)?;

    Ok(Handshake {
        protocol_version,
        next_state,
    })
}

/// Builds the JSON status-response body for a sleeping server. The client's own
/// protocol is echoed back so the entry renders as joinable (no "outdated
/// client" warning) — that's what makes the client actually attempt a login,
/// which is our wake trigger.
pub(in crate::app) fn build_status_response_json(motd: &str, protocol_version: i32) -> String {
    serde_json::json!({
        "version": { "name": "Sleeping", "protocol": protocol_version },
        "players": { "online": 0, "max": 0, "sample": [] },
        "description": { "text": motd },
    })
    .to_string()
}

/// Wraps a status-response JSON string in a status packet (state 1, id 0x00).
pub(in crate::app) fn build_status_packet(json: &str) -> Vec<u8> {
    let mut payload = encode_varint(0x00);
    payload.extend_from_slice(&encode_string(json));
    with_packet_length(&payload)
}

/// Builds a login Disconnect packet (login state, id 0x00) carrying a chat JSON
/// message — used to tell a joining player the server is waking up.
pub(in crate::app) fn build_login_disconnect_packet(message: &str) -> Vec<u8> {
    let reason = serde_json::json!({ "text": message }).to_string();
    let mut payload = encode_varint(0x00);
    payload.extend_from_slice(&encode_string(&reason));
    with_packet_length(&payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_varint_matches_known_values() {
        assert_eq!(encode_varint(0), vec![0x00]);
        assert_eq!(encode_varint(1), vec![0x01]);
        assert_eq!(encode_varint(127), vec![0x7f]);
        assert_eq!(encode_varint(128), vec![0x80, 0x01]);
        assert_eq!(encode_varint(255), vec![0xff, 0x01]);
        assert_eq!(encode_varint(25565), vec![0xdd, 0xc7, 0x01]);
    }

    #[test]
    fn varint_round_trips_through_slice() {
        for value in [0, 1, 127, 128, 255, 25565, 2_097_151, i32::MAX] {
            let encoded = encode_varint(value);
            let mut cursor = 0;
            assert_eq!(
                read_varint_from_slice(&encoded, &mut cursor).unwrap(),
                value
            );
            assert_eq!(cursor, encoded.len());
        }
    }

    #[test]
    fn string_round_trips_through_slice() {
        let mut data = encode_string("hi there");
        let extra = data.len();
        data.push(0xAB); // trailing byte should be left untouched
        let mut cursor = 0;
        assert_eq!(
            read_string_from_slice(&data, &mut cursor).unwrap(),
            "hi there"
        );
        assert_eq!(cursor, extra);
    }

    #[test]
    fn read_handshake_parses_status_intent() {
        // Build a real handshake packet and feed it through a loopback socket.
        let mut payload = encode_varint(0x00); // packet id
        payload.extend_from_slice(&encode_varint(765)); // protocol version
        payload.extend_from_slice(&encode_string("localhost")); // server address
        payload.extend_from_slice(&[0x63, 0xDD]); // port 25565, big-endian
        payload.extend_from_slice(&encode_varint(1)); // next state: status
        let framed = with_packet_length(&payload);

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let (mut client, _) = listener.accept().unwrap();
            std::io::Write::write_all(&mut client, &framed).unwrap();
        });

        let mut stream = TcpStream::connect(addr).unwrap();
        let handshake = read_handshake(&mut stream).unwrap();
        assert_eq!(handshake.protocol_version, 765);
        assert_eq!(handshake.next_state, 1);
        handle.join().unwrap();
    }

    #[test]
    fn status_response_json_carries_motd_and_protocol() {
        let json = build_status_response_json("Sleeping — join to wake", 765);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["description"]["text"], "Sleeping — join to wake");
        assert_eq!(parsed["version"]["protocol"], 765);
        assert_eq!(parsed["players"]["online"], 0);
    }

    #[test]
    fn status_packet_framing_round_trips() {
        let json = build_status_response_json("nap", 765);
        let packet = build_status_packet(&json);
        // [len][id=0x00][string]
        let mut cursor = 0;
        let declared_len = read_varint_from_slice(&packet, &mut cursor).unwrap() as usize;
        assert_eq!(declared_len, packet.len() - cursor);
        let id = read_varint_from_slice(&packet, &mut cursor).unwrap();
        assert_eq!(id, 0x00);
        let body = read_string_from_slice(&packet, &mut cursor).unwrap();
        assert_eq!(body, json);
    }

    #[test]
    fn login_disconnect_carries_chat_message() {
        let packet = build_login_disconnect_packet("Waking up, rejoin soon");
        let mut cursor = 0;
        let _len = read_varint_from_slice(&packet, &mut cursor).unwrap();
        let id = read_varint_from_slice(&packet, &mut cursor).unwrap();
        assert_eq!(id, 0x00);
        let body = read_string_from_slice(&packet, &mut cursor).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed["text"], "Waking up, rejoin soon");
    }
}
