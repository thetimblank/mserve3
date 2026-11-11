//! UPnP (IGD) router port forwarding.
//!
//! When a server has `upnp_enabled`, mserve asks the router to forward the
//! server's TCP port to this PC while the server runs, so friends can join over
//! the public IP without a manual port-forwarding rule. It is the no-third-party
//! alternative to the playit tunnel, and it only helps when the router is the
//! one holding the public IP: behind CGNAT or a second router it can't work, and
//! we say so instead of reporting a forward that nobody can reach.
//!
//! Mappings are leased (`LEASE_SECONDS`) and renewed while the server runs, then
//! removed when it stops, so a crash or a hard quit cleans itself up when the
//! lease runs out. Routers that only accept permanent leases get one, still
//! removed on stop.
//!
//! **Ownership.** A restart cancels the old mapping task and starts a new one for
//! the same port, and the two run concurrently. To stop the old task's removal
//! from deleting the new task's fresh mapping, every map/renew/remove runs under
//! one lock and checks which task currently owns the port (`OWNERS`).

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use igd_next::{AddPortError, Gateway, PortMappingProtocol, RemovePortError, SearchOptions};
use serde::Serialize;
use tauri::Emitter;

const UPNP_STATE_EVENT: &str = "server-upnp-state";
/// How long the router keeps a mapping without a renewal.
const LEASE_SECONDS: u32 = 60 * 60;
/// How often a running server's mapping is renewed (well inside the lease).
pub(in crate::app) const RENEW_INTERVAL: Duration = Duration::from_secs(20 * 60);
/// How long to wait for the router to answer discovery.
const SEARCH_TIMEOUT: Duration = Duration::from_secs(4);
/// Short lease for the setup guide's check, in case removing it fails.
const CHECK_LEASE_SECONDS: u32 = 120;
/// Routers reject long mapping descriptions; keep ours short.
const MAX_DESCRIPTION_CHARS: usize = 32;

/// Which mapping task owns each forwarded port (see the module docs).
static OWNERS: Mutex<Option<HashMap<u16, u64>>> = Mutex::new(None);
static NEXT_OWNER: AtomicU64 = AtomicU64::new(1);

/// A fresh owner id for one server run's mapping task.
pub(in crate::app) fn new_owner() -> u64 {
    NEXT_OWNER.fetch_add(1, Ordering::Relaxed)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerUpnpStateEvent {
    directory: String,
    /// "starting" | "active" | "error" | "off"
    status: String,
    address: Option<String>,
    error: Option<String>,
}

/// Emits a `server-upnp-state` transition for a server.
pub(in crate::app) fn emit_upnp_state(
    app: &tauri::AppHandle,
    directory: &str,
    status: &str,
    address: Option<String>,
    error: Option<String>,
) {
    let _ = app.emit(
        UPNP_STATE_EVENT,
        ServerUpnpStateEvent {
            directory: directory.to_string(),
            status: status.to_string(),
            address,
            error,
        },
    );
}

/// A forward the router accepted.
pub(in crate::app) struct UpnpMapping {
    /// The router's public (WAN) IP, which players join on.
    pub(in crate::app) external_ip: IpAddr,
    /// The router only accepts permanent leases, so there is nothing to renew.
    pub(in crate::app) permanent: bool,
}

impl UpnpMapping {
    /// The address players join with.
    pub(in crate::app) fn address(&self, port: u16) -> String {
        format!("{}:{port}", self.external_ip)
    }
}

/// A router mapping description: `mserve: <server name>`, kept short.
pub(in crate::app) fn mapping_description(server_name: &str) -> String {
    format!("mserve: {server_name}")
        .chars()
        .take(MAX_DESCRIPTION_CHARS)
        .collect()
}

/// True when the router's WAN IP can't be reached from the internet: a private
/// or CGNAT (100.64.0.0/10) address means another NAT sits in front of it.
fn is_unroutable_wan_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || (a == 100 && (64..128).contains(&b))
        }
        IpAddr::V6(_) => false,
    }
}

fn local_ipv4() -> Result<Ipv4Addr, String> {
    super::resolve_local_ip()
        .and_then(|ip| ip.parse::<Ipv4Addr>().ok())
        .ok_or_else(|| "Couldn't find this PC's local IPv4 address.".to_string())
}

/// Finds the router. Discovery goes out on the local network's interface, so a
/// VPN or virtual adapter doesn't swallow it.
fn discover(local_ip: Ipv4Addr) -> Result<Gateway, String> {
    // `SearchOptions` is non-exhaustive, so start from the defaults.
    let mut options = SearchOptions::default();
    options.bind_addr = SocketAddr::new(IpAddr::V4(local_ip), 0);
    options.timeout = Some(SEARCH_TIMEOUT);
    options.single_search_timeout = Some(SEARCH_TIMEOUT);
    igd_next::search_gateway(options).map_err(|_| {
        "Your router didn't answer. UPnP may be turned off in its settings, or it doesn't \
         support it. Turn on UPnP in the router, or forward the port by hand."
            .to_string()
    })
}

fn map_add_port_error(err: AddPortError, port: u16) -> String {
    match err {
        AddPortError::PortInUse => format!(
            "Port {port} is already forwarded on your router (to another device, or by a rule \
             you added by hand). Remove that rule or use another port. If the rule points at \
             this PC, you can turn UPnP off."
        ),
        AddPortError::ActionNotAuthorized => {
            "Your router refused to forward the port. Allow UPnP port mapping in its settings, \
             or forward the port by hand."
                .to_string()
        }
        other => format!("Your router rejected the port forward: {other}"),
    }
}

/// Asks the router to forward `port` (TCP) to this PC. Fails up front when the
/// router has no public IP (CGNAT / double NAT), since the forward would be useless.
fn add_mapping(port: u16, description: &str, lease: u32) -> Result<UpnpMapping, String> {
    let local_ip = local_ipv4()?;
    let gateway = discover(local_ip)?;

    let external_ip = gateway.get_external_ip().map_err(|err| {
        format!("Your router answered, but wouldn't report its public IP ({err}).")
    })?;
    if is_unroutable_wan_ip(external_ip) {
        return Err(format!(
            "Your router's internet address ({external_ip}) is not public. Your provider \
             (CGNAT) or another router sits in front of it, so a forward can't reach this PC. \
             Use the tunnel instead."
        ));
    }

    let local_addr = SocketAddr::V4(SocketAddrV4::new(local_ip, port));
    match gateway.add_port(
        PortMappingProtocol::TCP,
        port,
        local_addr,
        lease,
        description,
    ) {
        Ok(()) => Ok(UpnpMapping {
            external_ip,
            permanent: lease == 0,
        }),
        Err(AddPortError::OnlyPermanentLeasesSupported) if lease != 0 => gateway
            .add_port(PortMappingProtocol::TCP, port, local_addr, 0, description)
            .map(|()| UpnpMapping {
                external_ip,
                permanent: true,
            })
            .map_err(|err| map_add_port_error(err, port)),
        Err(err) => Err(map_add_port_error(err, port)),
    }
}

fn remove_mapping(port: u16) -> Result<(), String> {
    let gateway = discover(local_ipv4()?)?;
    match gateway.remove_port(PortMappingProtocol::TCP, port) {
        Ok(()) | Err(RemovePortError::NoSuchPortMapping) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

fn with_owners<T>(f: impl FnOnce(&mut HashMap<u16, u64>) -> T) -> T {
    let mut guard = OWNERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    f(guard.get_or_insert_with(HashMap::new))
}

/// Maps `port` for `owner`, taking the port over from any earlier task.
/// Blocking (network I/O): call from `spawn_blocking`.
pub(in crate::app) fn claim_mapping(
    owner: u64,
    port: u16,
    description: &str,
) -> Result<UpnpMapping, String> {
    with_owners(|owners| {
        let mapping = add_mapping(port, description, LEASE_SECONDS)?;
        owners.insert(port, owner);
        Ok(mapping)
    })
}

/// Renews `owner`'s mapping. `None` when another task has taken the port over.
/// Blocking (network I/O): call from `spawn_blocking`.
pub(in crate::app) fn renew_mapping(
    owner: u64,
    port: u16,
    description: &str,
) -> Option<Result<UpnpMapping, String>> {
    with_owners(|owners| {
        (owners.get(&port) == Some(&owner)).then(|| add_mapping(port, description, LEASE_SECONDS))
    })
}

/// Removes `owner`'s mapping. Returns false (and leaves the router alone) when
/// another task has taken the port over. Blocking: call from `spawn_blocking`.
pub(in crate::app) fn release_mapping(owner: u64, port: u16) -> bool {
    with_owners(|owners| {
        if owners.get(&port) != Some(&owner) {
            return false;
        }
        owners.remove(&port);
        if let Err(err) = remove_mapping(port) {
            eprintln!("[upnp] failed to remove the mapping for port {port}: {err}");
        }
        true
    })
}

/// Checks that the router forwards `port` on request (setup guide): maps it with a
/// short lease and removes it again. Returns the public IP players would join on.
/// Skips ports a running server's mapping already owns. Blocking.
pub(in crate::app) fn check_upnp(port: u16) -> Result<String, String> {
    with_owners(|owners| {
        let local_ip = local_ipv4()?;
        if owners.contains_key(&port) {
            let gateway = discover(local_ip)?;
            let ip = gateway
                .get_external_ip()
                .map_err(|err| format!("Your router wouldn't report its public IP ({err})."))?;
            return Ok(ip.to_string());
        }
        let mapping = add_mapping(port, "mserve: check", CHECK_LEASE_SECONDS)?;
        if let Err(err) = remove_mapping(port) {
            eprintln!("[upnp] failed to remove the check mapping for port {port}: {err}");
        }
        Ok(mapping.external_ip.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_private_and_cgnat_wan_addresses() {
        for ip in [
            "10.1.2.3",
            "192.168.1.1",
            "172.16.0.9",
            "100.64.0.1",
            "100.127.255.254",
            "0.0.0.0",
        ] {
            assert!(is_unroutable_wan_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "100.63.255.255", "100.128.0.1", "203.0.113.7"] {
            assert!(!is_unroutable_wan_ip(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn caps_mapping_description_length() {
        let description = mapping_description("a really long server folder name that keeps going");
        assert_eq!(description.chars().count(), MAX_DESCRIPTION_CHARS);
        assert!(description.starts_with("mserve: "));
        assert_eq!(mapping_description("smp"), "mserve: smp");
    }

    #[test]
    fn only_the_owner_releases_a_port() {
        // A port nobody owns (no router I/O happens on the refusal path).
        let stale = new_owner();
        let current = new_owner();
        with_owners(|owners| owners.insert(1, current));
        assert!(!release_mapping(stale, 1));
        assert_eq!(with_owners(|owners| owners.get(&1).copied()), Some(current));
        with_owners(|owners| owners.remove(&1));
    }
}
