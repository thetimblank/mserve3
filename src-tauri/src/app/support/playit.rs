//! playit.gg tunneling subsystem.
//!
//! Lets a server be reached over the public internet with no router/firewall
//! config, via playit.gg's free persistent address. Everything runs in-process:
//!
//!   * **Account** — a single global playit "self-managed agent" secret is stored
//!     once in the app data dir (`playit/secret.key`). Claiming is a pure REST
//!     flow (generate a code → user approves at a claim URL → exchange for the
//!     secret), driven with the official `playit-api-client`.
//!   * **Tunnels** — per server. We find-or-create a `minecraft-java` TCP tunnel
//!     (REST) whose origin points at the server's loopback port, and surface its
//!     persistent `assigned_domain` as the public address.
//!   * **Agent** — per server we run `playit_agent_core::PlayitAgent` on Tauri's
//!     async runtime. An `OriginLookup` maps the tunnel to `127.0.0.1:<port>`.
//!     The agent's `keep_running` flag is the stop handle: flip it to `false` and
//!     the run loop unwinds. Lifecycle is tied to the Minecraft process — the
//!     supervisor / stop paths cancel the agent when the server goes down.
//!
//! NOTE: one agent connection per tunneled server, all sharing the global secret.
//! This is the clean per-server fit; if playit ever rejects concurrent agent
//! connections under one secret, the fallback is a single shared agent whose
//! `OriginLookup` holds every active tunnel — localized to this module.

use std::iter;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use rand::RngCore;
use serde::Serialize;
use tauri::{Emitter, Manager};

use playit_agent_core::network::origin_lookup::{OriginLookup, OriginResource};
use playit_agent_core::network::tcp::tcp_settings::TcpSettings;
use playit_agent_core::network::udp::udp_settings::UdpSettings;
use playit_agent_core::playit_agent::{PlayitAgent, PlayitAgentSettings};
use playit_agent_proto::PortProto;
use playit_api_client::PlayitApi;
use playit_api_client::api::{
    AgentTunnel, AgentType, AssignedAgentCreate, ClaimSetupResponse, PortType, ReqClaimExchange,
    ReqClaimSetup, ReqTunnelsCreate, TunnelOriginCreate, TunnelType,
};

const API_BASE: &str = "https://api.playit.gg";
const CLAIM_BASE: &str = "https://playit.gg/claim";
/// Sent to `claim_setup` as the agent version string (kept short; playit rejects
/// overly long version text).
const AGENT_VERSION: &str = concat!("mserve-", env!("CARGO_PKG_VERSION"));
/// Standard Minecraft Java port; playit minecraft-java tunnels expose an
/// SRV-backed domain so the bare hostname is joinable when the public port is 25565.
const DEFAULT_MC_PORT: u16 = 25565;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const CLAIM_STATE_EVENT: &str = "playit-claim-state";
const TUNNEL_STATE_EVENT: &str = "playit-tunnel-state";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayitClaimStateEvent {
    /// "pending" | "claimed" | "error"
    status: String,
    claim_url: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayitTunnelStateEvent {
    directory: String,
    /// "starting" | "online" | "error" | "offline"
    status: String,
    address: Option<String>,
    error: Option<String>,
}

fn emit_claim(
    app: &tauri::AppHandle,
    status: &str,
    claim_url: Option<String>,
    error: Option<String>,
) {
    let _ = app.emit(
        CLAIM_STATE_EVENT,
        PlayitClaimStateEvent {
            status: status.to_string(),
            claim_url,
            error,
        },
    );
}

/// Emits a `playit-tunnel-state` transition for a server.
pub(in crate::app) fn emit_tunnel_state(
    app: &tauri::AppHandle,
    directory: &str,
    status: &str,
    address: Option<String>,
    error: Option<String>,
) {
    let _ = app.emit(
        TUNNEL_STATE_EVENT,
        PlayitTunnelStateEvent {
            directory: directory.to_string(),
            status: status.to_string(),
            address,
            error,
        },
    );
}

// ---------------------------------------------------------------------------
// Global account / secret
// ---------------------------------------------------------------------------

/// Path to the global playit agent secret (`<app data>/playit/secret.key`).
pub(in crate::app) fn secret_file_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|dir| dir.join("playit").join("secret.key"))
}

/// Reads the stored agent secret, if the account has been claimed.
pub(in crate::app) fn read_secret(app: &tauri::AppHandle) -> Option<String> {
    let path = secret_file_path(app)?;
    let secret = std::fs::read_to_string(path).ok()?;
    let trimmed = secret.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn write_secret(app: &tauri::AppHandle, secret: &str) -> Result<(), String> {
    let path = secret_file_path(app).ok_or("Could not resolve the app data directory.")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    std::fs::write(&path, secret.trim()).map_err(|err| err.to_string())
}

/// Removes the stored secret so the install can be re-claimed.
pub(in crate::app) fn clear_secret(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(path) = secret_file_path(app)
        && path.exists()
    {
        std::fs::remove_file(path).map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// True once a global playit account secret is stored.
pub(in crate::app) fn is_claimed(app: &tauri::AppHandle) -> bool {
    read_secret(app).is_some()
}

// ---------------------------------------------------------------------------
// Claim flow (pure REST)
// ---------------------------------------------------------------------------

/// A fresh random claim code (10 hex chars, matching the official agent).
pub(in crate::app) fn generate_claim_code() -> String {
    let mut bytes = [0u8; 5];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The browser URL a user visits to approve a claim code.
pub(in crate::app) fn claim_url(code: &str) -> String {
    format!("{CLAIM_BASE}/{code}?type=self-managed&name=mserve")
}

/// Drives a claim to completion: polls `claim_setup` until the user approves (or
/// rejects/expires), exchanges the code for the agent secret, persists it, and
/// emits `playit-claim-state` transitions throughout. Runs on the async runtime.
pub(in crate::app) async fn drive_claim(app: tauri::AppHandle, code: String) {
    let api = PlayitApi::create(API_BASE.to_string(), None);
    let url = claim_url(&code);
    emit_claim(&app, "pending", Some(url.clone()), None);

    // The user has to visit the URL and approve, so allow a generous wall-clock.
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        if Instant::now() >= deadline {
            emit_claim(
                &app,
                "error",
                None,
                Some("Claim timed out. Try again.".to_string()),
            );
            return;
        }

        match api
            .claim_setup(ReqClaimSetup {
                code: code.clone(),
                agent_type: AgentType::SelfManaged,
                version: AGENT_VERSION.to_string(),
            })
            .await
        {
            Ok(ClaimSetupResponse::UserAccepted) => break,
            Ok(ClaimSetupResponse::UserRejected) => {
                emit_claim(&app, "error", None, Some("Claim was rejected.".to_string()));
                return;
            }
            // Still waiting for the user to visit / approve.
            Ok(ClaimSetupResponse::WaitingForUserVisit | ClaimSetupResponse::WaitingForUser) => {}
            Err(err) => {
                // Transient/network errors are retried until the deadline; the
                // terminal ones (expired/invalid) will keep failing and time out.
                eprintln!("[playit] claim_setup poll error: {err}");
            }
        }

        tokio::time::sleep(Duration::from_secs(3)).await;
    }

    // Approved: exchange the code for the permanent secret (may briefly report
    // NotAccepted while the approval propagates).
    loop {
        if Instant::now() >= deadline {
            emit_claim(
                &app,
                "error",
                None,
                Some("Claim timed out. Try again.".to_string()),
            );
            return;
        }
        match api
            .claim_exchange(ReqClaimExchange { code: code.clone() })
            .await
        {
            Ok(secret) => {
                if let Err(err) = write_secret(&app, &secret.secret_key) {
                    emit_claim(
                        &app,
                        "error",
                        None,
                        Some(format!("Failed to save secret: {err}")),
                    );
                    return;
                }
                emit_claim(&app, "claimed", None, None);
                return;
            }
            Err(err) => {
                eprintln!("[playit] claim_exchange not ready: {err}");
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tunnel provisioning + in-process agent
// ---------------------------------------------------------------------------

/// A live tunnel: the public address to surface, the persisted tunnel id, and the
/// agent stop handle (flip to `false` to shut the agent down).
pub(in crate::app) struct TunnelHandle {
    pub(in crate::app) address: String,
    pub(in crate::app) tunnel_id: String,
    pub(in crate::app) stop: Arc<AtomicBool>,
}

/// Public address to display for a tunnel. minecraft-java tunnels are SRV-backed,
/// so the bare hostname is joinable when the public port is the default 25565;
/// otherwise we append the explicit port.
fn tunnel_address(tunnel: &AgentTunnel) -> String {
    if tunnel.port.from == DEFAULT_MC_PORT {
        tunnel.assigned_domain.clone()
    } else {
        format!("{}:{}", tunnel.assigned_domain, tunnel.port.from)
    }
}

fn loopback(port: u16) -> SocketAddr {
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)
}

/// Locates this server's existing tunnel in the agent run data, preferring a
/// match on the stored tunnel id and falling back to a minecraft-java tunnel that
/// already targets this loopback port.
fn find_existing_tunnel<'a>(
    tunnels: &'a [AgentTunnel],
    stored_id: Option<&str>,
    local_port: u16,
) -> Option<&'a AgentTunnel> {
    if let Some(id) = stored_id
        && let Some(found) = tunnels.iter().find(|t| t.id.to_string() == id)
    {
        return Some(found);
    }
    tunnels
        .iter()
        .find(|t| t.tunnel_type.as_deref() == Some("minecraft-java") && t.local_port == local_port)
}

/// Provisions (find-or-create) a minecraft-java tunnel for `local_port`, then
/// starts an in-process agent routing it to `127.0.0.1:local_port`. Returns once
/// the public address is known and the agent task is spawned.
pub(in crate::app) async fn start_tunnel(
    secret: String,
    server_name: String,
    local_port: u16,
    stored_tunnel_id: Option<String>,
) -> Result<TunnelHandle, String> {
    let api = PlayitApi::create(API_BASE.to_string(), Some(secret.clone()));

    let run_data = api
        .agents_rundata()
        .await
        .map_err(|err| format!("Failed to read playit account: {err}"))?;
    let agent_id = run_data.agent_id;

    // Find-or-create the tunnel and resolve its id + public address.
    let (tunnel_uuid, internal_id, address) =
        match find_existing_tunnel(&run_data.tunnels, stored_tunnel_id.as_deref(), local_port) {
            Some(existing) => (
                existing.id.to_string(),
                existing.internal_id,
                tunnel_address(existing),
            ),
            None => {
                let created = api
                    .tunnels_create(ReqTunnelsCreate {
                        name: Some(server_name),
                        tunnel_type: Some(TunnelType::MinecraftJava),
                        port_type: PortType::Tcp,
                        port_count: 1,
                        origin: TunnelOriginCreate::Agent(AssignedAgentCreate {
                            agent_id,
                            local_ip: IpAddr::V4(Ipv4Addr::LOCALHOST),
                            local_port: Some(local_port),
                        }),
                        enabled: true,
                        alloc: None,
                        firewall_id: None,
                        proxy_protocol: None,
                    })
                    .await
                    .map_err(|err| format!("Failed to create playit tunnel: {err}"))?;
                wait_for_tunnel(&api, &created.id.to_string()).await?
            }
        };

    // Pin routing to the *actual* runtime port (the server may have been bumped
    // off a conflicting port at start), independent of what playit has stored.
    let lookup = Arc::new(OriginLookup::default());
    lookup
        .update(iter::once(OriginResource {
            tunnel_id: internal_id,
            proto: PortProto::Tcp,
            local_addr: loopback(local_port),
            port_count: 1,
            proxy_protocol: None,
        }))
        .await;

    let settings = PlayitAgentSettings {
        api_url: API_BASE.to_string(),
        secret_key: secret,
        tcp_settings: TcpSettings::default(),
        udp_settings: UdpSettings::default(),
    };
    let agent = PlayitAgent::new(settings, lookup)
        .await
        .map_err(|err| format!("Failed to start playit agent: {err:?}"))?;
    let stop = agent.keep_running();

    tauri::async_runtime::spawn(agent.run());

    Ok(TunnelHandle {
        address,
        tunnel_id: tunnel_uuid,
        stop,
    })
}

/// Polls the agent run data until a just-created tunnel shows up with an assigned
/// public address (newly created tunnels start out in `pending`).
async fn wait_for_tunnel(
    api: &PlayitApi,
    tunnel_id: &str,
) -> Result<(String, u64, String), String> {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let run_data = api
            .agents_rundata()
            .await
            .map_err(|err| format!("Failed to read playit tunnels: {err}"))?;

        if let Some(found) = run_data
            .tunnels
            .iter()
            .find(|t| t.id.to_string() == tunnel_id && !t.assigned_domain.is_empty())
        {
            return Ok((
                found.id.to_string(),
                found.internal_id,
                tunnel_address(found),
            ));
        }

        if Instant::now() >= deadline {
            return Err(
                "playit tunnel was created but no address was assigned in time.".to_string(),
            );
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

/// Signals an agent to stop (idempotent; safe to call on an already-stopped agent).
pub(in crate::app) fn stop_agent(stop: &Arc<AtomicBool>) {
    stop.store(false, Ordering::SeqCst);
}
