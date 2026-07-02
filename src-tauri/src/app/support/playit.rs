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
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rand::RngCore;
use serde::Serialize;
use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

use playit_agent_core::network::origin_lookup::{
    OriginIp, OriginLookup, OriginResource, OriginTarget,
};
use playit_agent_core::network::tcp::tcp_settings::TcpSettings;
use playit_agent_core::network::udp::udp_settings::UdpSettings;
use playit_agent_core::playit_agent::{PlayitAgent, PlayitAgentSettings};
use playit_agent_proto::PortProto;
use playit_api_client::PlayitApi;
use playit_api_client::api::{
    AgentTunnel, AssignedAgentCreate, ClaimAgentType, ClaimSetupResponse, PortType,
    ReqClaimExchange, ReqClaimSetup, ReqTunnelsCreate, TunnelOriginCreate, TunnelType,
};

const API_BASE: &str = "https://api.playit.gg";
const CLAIM_BASE: &str = "https://playit.gg/claim";
/// Version string reported to `claim_setup`. playit gates tunnel creation on a
/// minimum agent version and parses this as `"<name> <semver>"` (the official CLI
/// sends `format!("playit {}", <playit release version>)`). Crucially this must be
/// the **playit service/release version** (currently `1.0.x`), NOT the version of
/// the `playit-agent-core` *crate* we depend on (`0.20.1`) — those are different
/// numbering schemes, and `0.20.1 < 1.0.0`, so reporting the crate version makes
/// playit reject tunnel creation with `AgentVersionTooOld`. Bump this to track
/// playit's current release (https://github.com/playit-cloud/playit-agent/releases).
const AGENT_VERSION: &str = "playit 1.0.10";
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
                agent_type: ClaimAgentType::SelfManaged,
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
/// agent stop handle (cancel it to shut the agent down).
pub(in crate::app) struct TunnelHandle {
    pub(in crate::app) address: String,
    pub(in crate::app) tunnel_id: String,
    pub(in crate::app) cancel: CancellationToken,
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

/// An `OriginTarget` pointing at the server's loopback port (where the agent routes
/// inbound tunnel traffic).
fn loopback_target(port: u16) -> OriginTarget {
    OriginTarget::Port {
        ip: OriginIp::IpAddress(IpAddr::V4(Ipv4Addr::LOCALHOST)),
        port,
    }
}

/// Turns a `tunnels_create` failure into a user-facing message. playit's API can
/// return newer error variants than the pinned `playit-api-client` knows about — in
/// particular `AgentVersionTooOld`, which then surfaces as a raw JSON parse error —
/// so we sniff the stringified error for the ones worth explaining plainly.
fn map_tunnel_create_error(err: impl std::fmt::Display) -> String {
    let text = err.to_string();
    if text.contains("AgentVersionTooOld") || text.contains("AgentNotFound") {
        return "playit didn't recognize the tunneling agent in time — it may not have \
                finished connecting. Wait a moment and try again; if it keeps failing, \
                make sure mserve can reach playit.gg (firewall/VPN)."
            .to_string();
    }
    if text.contains("RequiresVerifiedAccount") {
        return "playit requires a verified account to create this tunnel. Verify your \
                email on playit.gg, then try again."
            .to_string();
    }
    format!("Failed to create playit tunnel: {text}")
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

/// Provisions (find-or-create) a minecraft-java tunnel for `local_port` and starts
/// an in-process agent routing it to `127.0.0.1:local_port`.
///
/// **Ordering matters.** playit gates tunnel creation on a *live, registered* agent,
/// so we start the agent — which connects to playit's control server and registers
/// its version during `PlayitAgent::new` — *before* creating the tunnel. Doing it the
/// other way (create tunnel, then start agent) means no agent has ever connected at
/// creation time, and playit rejects it with `AgentVersionTooOld` / "agent offline".
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

    // Start the agent first. `PlayitAgent::new` authenticates + registers the agent
    // (with its version) against playit's control server, so by the time it returns
    // the agent is online. It routes inbound traffic via the shared `OriginLookup`,
    // which we populate with the tunnel mapping once the tunnel id is known.
    let lookup = Arc::new(OriginLookup::default());
    let settings = PlayitAgentSettings {
        api_url: API_BASE.to_string(),
        secret_key: secret,
        tcp_settings: TcpSettings::default(),
        udp_settings: UdpSettings::default(),
    };
    let agent = PlayitAgent::new(settings, lookup.clone())
        .await
        .map_err(|err| format!("Failed to start playit agent: {err:?}"))?;
    let cancel = agent.cancellation_token();
    tauri::async_runtime::spawn(agent.run());

    // With the agent registered, find-or-create the tunnel. If anything fails, shut
    // the agent we just started back down so it doesn't linger.
    let (tunnel_uuid, internal_id, address) = match provision_tunnel(
        &api,
        &run_data.tunnels,
        stored_tunnel_id.as_deref(),
        &server_name,
        agent_id,
        local_port,
    )
    .await
    {
        Ok(resolved) => resolved,
        Err(err) => {
            cancel.cancel();
            return Err(err);
        }
    };

    // Pin routing to the *actual* runtime port (the server may have been bumped
    // off a conflicting port at start), independent of what playit has stored.
    lookup
        .update(iter::once(OriginResource {
            tunnel_id: internal_id,
            proto: PortProto::Tcp,
            target: loopback_target(local_port),
            port_count: 1,
            proxy_protocol: None,
        }))
        .await;

    Ok(TunnelHandle {
        address,
        tunnel_id: tunnel_uuid,
        cancel,
    })
}

/// Resolves this server's tunnel: reuse an existing one, or create a fresh
/// minecraft-java tunnel. Returns `(uuid, internal_id, public_address)`.
async fn provision_tunnel(
    api: &PlayitApi,
    existing: &[AgentTunnel],
    stored_tunnel_id: Option<&str>,
    server_name: &str,
    agent_id: uuid::Uuid,
    local_port: u16,
) -> Result<(String, u64, String), String> {
    if let Some(found) = find_existing_tunnel(existing, stored_tunnel_id, local_port) {
        return Ok((
            found.id.to_string(),
            found.internal_id,
            tunnel_address(found),
        ));
    }

    let created = create_tunnel_with_retry(api, server_name, agent_id, local_port).await?;
    wait_for_tunnel(api, &created).await
}

/// Creates a minecraft-java tunnel targeting the agent, retrying through the brief
/// window where playit's REST side hasn't yet caught up to the just-registered agent
/// (`AgentVersionTooOld` / `AgentNotFound`). Returns the new tunnel's UUID.
async fn create_tunnel_with_retry(
    api: &PlayitApi,
    server_name: &str,
    agent_id: uuid::Uuid,
    local_port: u16,
) -> Result<String, String> {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let result = api
            .tunnels_create(ReqTunnelsCreate {
                name: Some(server_name.to_string()),
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
            .await;

        match result {
            Ok(created) => return Ok(created.id.to_string()),
            Err(err) => {
                let text = err.to_string();
                let agent_not_ready =
                    text.contains("AgentVersionTooOld") || text.contains("AgentNotFound");
                if agent_not_ready && Instant::now() < deadline {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
                return Err(map_tunnel_create_error(err));
            }
        }
    }
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
pub(in crate::app) fn stop_agent(cancel: &CancellationToken) {
    cancel.cancel();
}
