//! Sleep-mode wake listener (lazymc-style). While a server is `Sleeping`, mserve
//! holds its TCP port with this listener and speaks just enough of the Minecraft
//! protocol to (a) answer a Server-List-Ping with a "sleeping" MOTD and (b) turn
//! a join attempt into a wake: it disconnects the client with a friendly message
//! and boots the real server.
//!
//! std sockets only (no async) so it builds identically on Windows and Linux.

use super::super::{LifecycleState, ServerOutputEvent, ServerRuntime, ServerRuntimeStateEvent};
use super::mc_protocol::{
    build_login_disconnect_packet, build_status_packet, build_status_response_json, read_handshake,
    read_varint_from_stream, with_packet_length,
};
use super::server_properties::read_property;
use super::telemetry::probe_port;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

type Processes = Arc<Mutex<HashMap<String, ServerRuntime>>>;

/// Per-connection I/O timeout — a client that stalls mid-handshake shouldn't wedge
/// the (single-threaded) accept loop.
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(3);
/// Idle sleep between non-blocking accept polls.
const ACCEPT_POLL: Duration = Duration::from_millis(150);
/// Message shown to a joining player while the server boots.
const WAKE_MESSAGE: &str = "§eWaking the server up…\n§7Rejoin in ~30 seconds.";

/// Everything the listener needs to serve pings and wake the server.
pub(in crate::app) struct SleepListenerParams {
    pub key: String,
    pub directory: String,
    pub server_port: u16,
    pub motd: String,
    pub java_executable: Option<String>,
    pub generation: u64,
}

/// What one accepted connection resulted in.
enum ConnectionOutcome {
    /// A ping was served (or the connection was ignored) — keep listening.
    Served,
    /// A login/transfer attempt: wake the server.
    Wake,
}

/// Binds the wake listener and starts its accept loop on a background thread.
/// Returns a shutdown flag: flip it (and let the port free) to stop the listener.
pub(in crate::app) fn spawn_sleep_listener(
    processes: Processes,
    app: tauri::AppHandle,
    params: SleepListenerParams,
) -> Result<Arc<AtomicBool>, String> {
    let bind_host = resolve_bind_host(Path::new(&params.directory));
    let bind_addr = format!("{bind_host}:{}", params.server_port);
    let listener = TcpListener::bind(&bind_addr)
        .map_err(|err| format!("Could not bind sleep listener on {bind_addr}: {err}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|err| format!("Could not configure sleep listener: {err}"))?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_thread = shutdown.clone();
    std::thread::spawn(move || {
        run_accept_loop(listener, processes, app, params, shutdown_thread);
    });
    Ok(shutdown)
}

/// Binds LAN-wide by default, or to `server-ip` when the server pins one.
fn resolve_bind_host(directory: &Path) -> String {
    read_property(directory, "server-ip")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "0.0.0.0".to_string())
}

fn run_accept_loop(
    listener: TcpListener,
    processes: Processes,
    app: tauri::AppHandle,
    params: SleepListenerParams,
    shutdown: Arc<AtomicBool>,
) {
    loop {
        if shutdown.load(Ordering::Relaxed) {
            return;
        }
        // Exit if the runtime is no longer the sleeping server we started for
        // (stopped, woken, replaced) — belt and braces against a leaked thread.
        if !still_sleeping(&processes, &params.key, params.generation) {
            return;
        }

        match listener.accept() {
            Ok((stream, _addr)) => match handle_connection(stream, &params) {
                ConnectionOutcome::Wake => {
                    // Release the port before spawning java so it can rebind.
                    shutdown.store(true, Ordering::Relaxed);
                    drop(listener);
                    wake_server(&processes, &app, &params);
                    return;
                }
                ConnectionOutcome::Served => {}
            },
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(ACCEPT_POLL);
            }
            Err(_) => {
                std::thread::sleep(ACCEPT_POLL);
            }
        }
    }
}

/// True while the map still holds our sleeping runtime at the same generation.
fn still_sleeping(processes: &Processes, key: &str, generation: u64) -> bool {
    let Ok(guard) = processes.lock() else {
        return false;
    };
    guard.get(key).is_some_and(|runtime| {
        runtime.generation == generation && matches!(runtime.state, LifecycleState::Sleeping)
    })
}

/// Serves one client: a status ping gets the sleeping MOTD; a login attempt is
/// answered with a disconnect message and signals a wake.
fn handle_connection(mut stream: TcpStream, params: &SleepListenerParams) -> ConnectionOutcome {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(CONNECTION_TIMEOUT));
    let _ = stream.set_write_timeout(Some(CONNECTION_TIMEOUT));

    let Ok(handshake) = read_handshake(&mut stream) else {
        return ConnectionOutcome::Served;
    };

    match handshake.next_state {
        // Status: answer the ping so the server list shows the sleeping MOTD.
        1 => {
            let json = build_status_response_json(&params.motd, handshake.protocol_version);
            if stream.write_all(&build_status_packet(&json)).is_ok() {
                let _ = stream.flush();
                // Best-effort pong so the client shows a latency instead of "?".
                echo_ping(&mut stream);
            }
            ConnectionOutcome::Served
        }
        // Login (2) or transfer (3): disconnect with a message, then wake.
        _ => {
            let _ = stream.write_all(&build_login_disconnect_packet(WAKE_MESSAGE));
            let _ = stream.flush();
            ConnectionOutcome::Wake
        }
    }
}

/// Reads a client Ping packet and echoes it back verbatim as the Pong.
fn echo_ping(stream: &mut TcpStream) {
    let Ok(length) = read_varint_from_stream(stream) else {
        return;
    };
    let Ok(length) = usize::try_from(length) else {
        return;
    };
    if length == 0 || length > 64 {
        return;
    }
    let mut body = vec![0_u8; length];
    if stream.read_exact(&mut body).is_ok() {
        // Re-frame the same [id=0x01][payload] body as the response.
        let _ = stream.write_all(&with_packet_length(&body));
        let _ = stream.flush();
    }
}

/// Waits for the port to free, then starts the real server. The listener has
/// already been dropped by the caller.
fn wake_server(processes: &Processes, app: &tauri::AppHandle, params: &SleepListenerParams) {
    emit_system_line(
        app,
        &params.directory,
        "A player is joining — waking the server…",
    );

    // Wait (bounded) for the OS to release the port we just held before java
    // tries to bind it. `probe_port` returns true while something still answers.
    for _ in 0..15 {
        if !probe_port("127.0.0.1", params.server_port, Duration::from_millis(200)) {
            break;
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    if let Err(err) = super::super::commands::start_server_internal(
        params.directory.clone(),
        params.java_executable.clone(),
        processes.clone(),
        app.clone(),
    ) {
        // Couldn't wake: drop the sleeping entry and report offline.
        if let Ok(mut guard) = processes.lock() {
            guard.remove(&params.key);
        }
        let _ = app.emit(
            "server-runtime-state",
            ServerRuntimeStateEvent {
                directory: params.directory.clone(),
                state: LifecycleState::Offline,
                pid: None,
                started_at: None,
                exit_code: None,
                stderr_tail: Vec::new(),
                server_port: Some(params.server_port),
            },
        );
        emit_system_line(
            app,
            &params.directory,
            format!("Failed to wake server: {err}"),
        );
    }
}

fn emit_system_line(app: &tauri::AppHandle, directory: &str, line: impl Into<String>) {
    let _ = app.emit(
        "server-output",
        ServerOutputEvent {
            directory: directory.to_string(),
            stream: "system".to_string(),
            line: line.into(),
        },
    );
}
