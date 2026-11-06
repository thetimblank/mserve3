//! Default gateway (router) detection for the hosting guide. No extra crate:
//! Windows parses `route print`, Linux reads `/proc/net/route`.

use std::net::Ipv4Addr;

/// One IPv4 default route: where it goes and how it's ranked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DefaultRoute {
    gateway: Ipv4Addr,
    /// The local address of the interface it leaves through: read directly on
    /// Windows, inferred from the interface's subnet routes on Linux. `None`
    /// when unknown.
    interface: Option<Ipv4Addr>,
    metric: u32,
}

/// Picks the route the OS most likely uses: the lowest-metric route leaving
/// through the interface that owns `local_ip` (this PC's address on the home
/// network) when there is one, otherwise the lowest metric overall. The
/// local-network preference skips VPN routes that win on metric alone.
fn pick_default_route(routes: &[DefaultRoute], local_ip: Option<Ipv4Addr>) -> Option<Ipv4Addr> {
    local_ip
        .and_then(|local| {
            routes
                .iter()
                .filter(|route| route.interface == Some(local))
                .min_by_key(|route| route.metric)
        })
        .or_else(|| routes.iter().min_by_key(|route| route.metric))
        .map(|route| route.gateway)
}

fn is_usable_gateway(gateway: Ipv4Addr) -> bool {
    !gateway.is_unspecified() && !gateway.is_loopback() && !gateway.is_broadcast()
}

/// Parses `route print -4 0.0.0.0` output. Active default routes are the rows
/// `0.0.0.0  0.0.0.0  <gateway>  <interface>  <metric>`; headers are localized,
/// so only the numeric rows are matched. "On-link" gateways and the
/// four-column "Persistent Routes" rows are skipped.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_windows_route_print(output: &str) -> Vec<DefaultRoute> {
    output
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            let [destination, netmask, gateway, interface, metric] = fields.as_slice() else {
                return None;
            };
            if *destination != "0.0.0.0" || *netmask != "0.0.0.0" {
                return None;
            }
            let gateway: Ipv4Addr = gateway.parse().ok()?;
            if !is_usable_gateway(gateway) {
                return None;
            }
            Some(DefaultRoute {
                gateway,
                interface: interface.parse().ok(),
                metric: metric.parse().ok()?,
            })
        })
        .collect()
}

/// One row of `/proc/net/route`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
struct LinuxRoute<'a> {
    iface: &'a str,
    destination: Ipv4Addr,
    gateway: Ipv4Addr,
    flags: u32,
    metric: u32,
    mask: Ipv4Addr,
}

/// Parses `/proc/net/route`. Addresses are the kernel's in-memory (little
/// endian) `u32` printed as hex, so `0101A8C0` is `192.168.1.1`. The file has
/// no interface addresses, so `local_ip` is matched against each interface's
/// on-link subnet routes (`192.168.1.0/24 dev eth0`): default routes leaving
/// through the most specific interface holding it get
/// `interface: Some(local_ip)`, as Windows reports them.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_linux_proc_net_route(contents: &str, local_ip: Option<Ipv4Addr>) -> Vec<DefaultRoute> {
    const RTF_UP: u32 = 0x1;
    const RTF_GATEWAY: u32 = 0x2;

    let address = |value: &str| {
        u32::from_str_radix(value, 16)
            .ok()
            .map(|raw| Ipv4Addr::from(raw.to_le_bytes()))
    };
    let rows: Vec<LinuxRoute> = contents
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 8 {
                return None;
            }
            Some(LinuxRoute {
                iface: fields[0],
                destination: address(fields[1])?,
                gateway: address(fields[2])?,
                flags: u32::from_str_radix(fields[3], 16).ok()?,
                metric: fields[6].parse().ok()?,
                mask: address(fields[7])?,
            })
        })
        .filter(|row| row.flags & RTF_UP != 0)
        .collect();

    let local_iface = local_ip.and_then(|local| {
        rows.iter()
            .filter(|row| !row.mask.is_unspecified() && row.flags & RTF_GATEWAY == 0)
            .filter(|row| u32::from(local) & u32::from(row.mask) == u32::from(row.destination))
            .max_by_key(|row| u32::from(row.mask).count_ones())
            .map(|row| row.iface)
    });

    rows.iter()
        .filter(|row| row.destination.is_unspecified() && row.mask.is_unspecified())
        .filter(|row| row.flags & RTF_GATEWAY != 0 && is_usable_gateway(row.gateway))
        .map(|row| DefaultRoute {
            gateway: row.gateway,
            interface: local_ip.filter(|_| local_iface == Some(row.iface)),
            metric: row.metric,
        })
        .collect()
}

/// The IPv4 default gateway (usually the home router), or `None` when it can't
/// be determined.
pub(in crate::app) fn resolve_default_gateway() -> Option<String> {
    let local_ip = super::resolve_local_ip().and_then(|ip| ip.parse::<Ipv4Addr>().ok());

    #[cfg(target_os = "windows")]
    let routes = {
        let output = super::no_window_command("route")
            .args(["print", "-4", "0.0.0.0"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        parse_windows_route_print(&String::from_utf8_lossy(&output.stdout))
    };

    #[cfg(target_os = "linux")]
    let routes =
        parse_linux_proc_net_route(&std::fs::read_to_string("/proc/net/route").ok()?, local_ip);

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let routes: Vec<DefaultRoute> = Vec::new();

    pick_default_route(&routes, local_ip).map(|gateway| gateway.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WINDOWS_ROUTE_PRINT: &str = "\
===========================================================================
Interface List
 15...18 c0 4d 3f 93 35 ......Realtek Gaming GbE Family Controller
  1...........................Software Loopback Interface 1
===========================================================================

IPv4 Route Table
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0     192.168.40.1   192.168.40.168     30
          0.0.0.0          0.0.0.0         10.0.0.1       10.0.0.23     25
          0.0.0.0          0.0.0.0         On-link        10.8.0.2      5
===========================================================================
Persistent Routes:
  Network Address          Netmask  Gateway Address  Metric
          0.0.0.0          0.0.0.0      172.16.0.1  Default
===========================================================================
";

    #[test]
    fn windows_parses_active_default_routes_only() {
        let routes = parse_windows_route_print(WINDOWS_ROUTE_PRINT);
        assert_eq!(
            routes,
            vec![
                DefaultRoute {
                    gateway: Ipv4Addr::new(192, 168, 40, 1),
                    interface: Some(Ipv4Addr::new(192, 168, 40, 168)),
                    metric: 30,
                },
                DefaultRoute {
                    gateway: Ipv4Addr::new(10, 0, 0, 1),
                    interface: Some(Ipv4Addr::new(10, 0, 0, 23)),
                    metric: 25,
                },
            ]
        );
    }

    #[test]
    fn windows_prefers_the_route_of_the_local_ip_interface() {
        let routes = parse_windows_route_print(WINDOWS_ROUTE_PRINT);
        assert_eq!(
            pick_default_route(&routes, Some(Ipv4Addr::new(192, 168, 40, 168))),
            Some(Ipv4Addr::new(192, 168, 40, 1))
        );
        // Unknown local IP: fall back to the lowest metric.
        assert_eq!(
            pick_default_route(&routes, None),
            Some(Ipv4Addr::new(10, 0, 0, 1))
        );
    }

    #[test]
    fn windows_without_a_default_route_finds_nothing() {
        let output = "Active Routes:\nNone\nPersistent Routes:\n  None\n";
        assert!(parse_windows_route_print(output).is_empty());
        assert_eq!(pick_default_route(&[], None), None);
    }

    #[test]
    fn linux_parses_little_endian_gateways() {
        let contents = "\
Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0
eth0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0
wlan0\t00000000\t0100000A\t0003\t0\t0\t600\t00000000\t0\t0\t0
";
        let routes = parse_linux_proc_net_route(contents, None);
        assert_eq!(routes.len(), 2);
        assert_eq!(
            pick_default_route(&routes, None),
            Some(Ipv4Addr::new(192, 168, 1, 1))
        );
    }

    #[test]
    fn linux_prefers_the_route_of_the_local_ip_network() {
        // A VPN (tun0) wins on metric, but this PC's LAN address is on wlan0.
        let contents = "\
Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
tun0\t00000000\t0100080A\t0003\t0\t0\t50\t00000000\t0\t0\t0
tun0\t0000080A\t00000000\t0001\t0\t0\t50\t0000FFFF\t0\t0\t0
wlan0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0
wlan0\t0001A8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF\t0\t0\t0
";
        let local = Ipv4Addr::new(192, 168, 1, 42);
        let routes = parse_linux_proc_net_route(contents, Some(local));
        assert_eq!(
            routes
                .iter()
                .map(|route| route.interface)
                .collect::<Vec<_>>(),
            vec![None, Some(local)]
        );
        assert_eq!(
            pick_default_route(&routes, Some(local)),
            Some(Ipv4Addr::new(192, 168, 1, 1))
        );
        // Unknown local IP: the lowest metric (the VPN) wins.
        assert_eq!(
            pick_default_route(&parse_linux_proc_net_route(contents, None), None),
            Some(Ipv4Addr::new(10, 8, 0, 1))
        );
    }

    #[test]
    fn linux_skips_routes_without_a_gateway_or_down() {
        let contents = "\
Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
tun0\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0
eth0\t00000000\t0101A8C0\t0002\t0\t0\t100\t00000000\t0\t0\t0
";
        assert!(parse_linux_proc_net_route(contents, None).is_empty());
    }
}
