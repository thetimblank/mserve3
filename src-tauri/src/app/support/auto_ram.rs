//! Auto RAM (`ram_mode: "auto"` in mserve.json): picks a server's max heap from
//! what it runs instead of a fixed number the user guessed.
//!
//! Java can't raise `-Xmx` while running, so "auto" is decided at each start:
//! an estimate from the server kind, its plugins/mods and player slots, capped
//! by what the machine can spare after a reserve for the OS and the heaps of the
//! other servers mserve is already running. The JVM then starts with a small
//! `-Xms` and grows inside that cap; on Java 12+ G1's periodic GC hands idle
//! memory back to the OS. This module is the one canonical home for the
//! estimate: the start path and the `get_auto_ram_plan` command both use it.

use super::super::{LifecycleState, ServerRuntime};
use super::read_property;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

pub(in crate::app) const RAM_MODE_AUTO: &str = "auto";
pub(in crate::app) const RAM_MODE_MANUAL: &str = "manual";

/// First Java release with `-XX:G1PeriodicGCInterval` (JEP 346).
const PERIODIC_GC_MIN_JAVA: u32 = 12;
/// How often an idle G1 heap runs a GC that can uncommit memory, in ms.
const PERIODIC_GC_INTERVAL_MS: u32 = 60_000;
/// Upper bound for any estimate; past this, more heap rarely helps a single
/// Minecraft server and long GC pauses start to hurt.
const MAX_ESTIMATE_GB: f64 = 16.0;
const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

/// Keeps `auto`/`manual`; anything else (missing, typo) becomes `fallback`.
pub(in crate::app) fn normalize_ram_mode(raw: Option<&str>, fallback: &str) -> String {
    match raw
        .map(|value| value.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some(RAM_MODE_AUTO) => RAM_MODE_AUTO.to_string(),
        Some(RAM_MODE_MANUAL) => RAM_MODE_MANUAL.to_string(),
        _ => fallback.to_string(),
    }
}

pub(in crate::app) fn is_auto_ram_mode(mode: Option<&str>) -> bool {
    mode.is_some_and(|value| value.trim().eq_ignore_ascii_case(RAM_MODE_AUTO))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::app) enum ServerKind {
    Proxy,
    Vanilla,
    Plugin,
    Modded,
    Modpack,
}

impl ServerKind {
    fn as_str(self) -> &'static str {
        match self {
            ServerKind::Proxy => "proxy",
            ServerKind::Vanilla => "vanilla",
            ServerKind::Plugin => "plugin",
            ServerKind::Modded => "modded",
            ServerKind::Modpack => "modpack",
        }
    }

    /// The smallest heap mserve will ever give this kind, even on a tight machine.
    fn minimum_gb(self) -> f64 {
        match self {
            ServerKind::Proxy => 0.5,
            ServerKind::Vanilla | ServerKind::Plugin => 1.0,
            ServerKind::Modded | ServerKind::Modpack => 2.0,
        }
    }
}

/// A modded server with at least this many mods is sized like a modpack, since
/// a modpack install leaves no marker beyond its mods.
const MODPACK_MOD_COUNT: u32 = 50;

/// Classifies a provider name (as stored in mserve.json). `modpack_hint` is set
/// by the create wizard, where the pack isn't installed yet.
pub(in crate::app) fn server_kind(
    provider_name: &str,
    mod_count: u32,
    modpack_hint: bool,
) -> ServerKind {
    let name = provider_name.trim().to_ascii_lowercase();
    let modded = ["fabric", "forge", "quilt"]
        .iter()
        .any(|loader| name.contains(loader));
    if modpack_hint || (modded && mod_count >= MODPACK_MOD_COUNT) {
        ServerKind::Modpack
    } else if modded {
        ServerKind::Modded
    } else if ["velocity", "bungee", "waterfall"]
        .iter()
        .any(|proxy| name.contains(proxy))
    {
        ServerKind::Proxy
    } else if name == "vanilla" || name.is_empty() {
        ServerKind::Vanilla
    } else {
        ServerKind::Plugin
    }
}

/// What the estimate looks at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::app) struct ServerFootprint {
    pub kind: ServerKind,
    pub plugin_count: u32,
    pub mod_count: u32,
    pub max_players: Option<u32>,
}

/// Heap the server would like, in GB, rounded to 0.5 GB. Not yet capped by the
/// machine (see [`plan_auto_ram`]).
pub(in crate::app) fn estimate_gb(footprint: &ServerFootprint) -> f64 {
    let half_steps = |count: u32, per: u32| f64::from(count / per) * 0.5;
    // Player slots beyond the default 20: +0.5 GB per 20, at most +2 GB (many
    // servers set a high max-players they never fill).
    let players = footprint.max_players.map_or(0.0, |slots| {
        half_steps(slots.saturating_sub(20), 20).min(2.0)
    });

    let estimate = match footprint.kind {
        // Proxies only route connections: 512 MB, 1 GB with a real plugin set.
        ServerKind::Proxy => {
            if footprint.plugin_count >= 10 {
                1.0
            } else {
                0.5
            }
        }
        ServerKind::Vanilla | ServerKind::Plugin => {
            3.0 + half_steps(footprint.plugin_count, 15) + players
        }
        ServerKind::Modded => 4.0 + half_steps(footprint.mod_count, 25) + players,
        ServerKind::Modpack => (4.0 + half_steps(footprint.mod_count, 25)).max(6.0) + players,
    };

    round_to(estimate.min(MAX_ESTIMATE_GB), 0.5)
}

/// Memory the machine can spare for one more server: total minus a reserve for
/// the OS and apps (max(3 GB, 20%)) minus the heaps of the other servers mserve
/// is running. Can be negative on a crowded machine; callers floor it.
pub(in crate::app) fn system_cap_gb(total_gb: f64, other_servers_gb: f64) -> f64 {
    let reserve = (total_gb * 0.2).max(3.0);
    total_gb - reserve - other_servers_gb.max(0.0)
}

/// The result of an auto-RAM decision, also sent to the UI.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(in crate::app) struct AutoRamPlan {
    /// "proxy" | "vanilla" | "plugin" | "modded" | "modpack"
    pub kind: String,
    /// What the server would like before the machine caps it.
    pub estimate_gb: f64,
    /// The `-Xmx` auto mode uses: the estimate, capped by `system_cap_gb`, never
    /// below `minimum_gb`.
    pub cap_gb: f64,
    /// The `-Xms` auto mode starts with.
    pub initial_gb: f64,
    pub minimum_gb: f64,
    pub system_cap_gb: f64,
    pub total_memory_gb: f64,
    /// Sum of the max heaps of the other servers mserve is running.
    pub other_servers_gb: f64,
    /// The estimate didn't fit, so the cap is lower than what the server wants.
    pub exceeds_system_cap: bool,
}

pub(in crate::app) fn plan_auto_ram(
    footprint: &ServerFootprint,
    total_gb: f64,
    other_servers_gb: f64,
) -> AutoRamPlan {
    let estimate = estimate_gb(footprint);
    let minimum = footprint.kind.minimum_gb();
    let system_cap = system_cap_gb(total_gb, other_servers_gb);
    // 256 MB steps so the heap token stays a clean `…M`/`…G`.
    let available = floor_to(system_cap, 0.25).max(minimum);
    let cap = estimate.min(available).max(minimum);
    let initial = floor_to((cap / 4.0).min(1.0), 0.25).max(0.25).min(cap);

    AutoRamPlan {
        kind: footprint.kind.as_str().to_string(),
        estimate_gb: estimate,
        cap_gb: cap,
        initial_gb: initial,
        minimum_gb: minimum,
        system_cap_gb: round_to(system_cap.max(0.0), 0.25),
        total_memory_gb: round_to(total_gb, 0.25),
        other_servers_gb: round_to(other_servers_gb.max(0.0), 0.25),
        exceeds_system_cap: estimate > cap,
    }
}

/// Reads what the estimate needs from a server folder. A missing folder (the
/// create wizard, before the server exists) reads as empty.
pub(in crate::app) fn read_footprint(
    directory: Option<&Path>,
    provider_name: &str,
    modpack_hint: bool,
) -> ServerFootprint {
    let count = |sub: &str| directory.map_or(0, |dir| count_jars(&dir.join(sub)));
    let plugin_count = count("plugins");
    let mod_count = count("mods");
    let max_players = directory
        .and_then(|dir| read_property(dir, "max-players"))
        .and_then(|value| value.trim().parse::<u32>().ok());

    ServerFootprint {
        kind: server_kind(provider_name, mod_count, modpack_hint),
        plugin_count,
        mod_count,
        max_players,
    }
}

/// Active plugin/mod jars only (disabled ones live under `inactive/`).
fn count_jars(directory: &Path) -> u32 {
    let Ok(entries) = fs::read_dir(directory) else {
        return 0;
    };
    let jars = entries
        .flatten()
        .filter(|entry| entry.path().is_file())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .ends_with(".jar")
        })
        .count();
    u32::try_from(jars).unwrap_or(u32::MAX)
}

/// Total physical memory in GB (fractional), or `None` if it can't be read.
pub(in crate::app) fn total_memory_gb() -> Option<f64> {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    let bytes = system.total_memory();
    (bytes > 0).then(|| bytes as f64 / GIB)
}

/// Sum of the max heaps of the servers mserve is running other than
/// `exclude_key`. Sleeping servers have no JVM, so they don't count.
pub(in crate::app) fn other_servers_heap_gb(
    processes: &HashMap<String, ServerRuntime>,
    exclude_key: &str,
) -> f64 {
    processes
        .iter()
        .filter(|(key, runtime)| {
            key.as_str() != exclude_key
                && runtime.state.is_active()
                && runtime.state != LifecycleState::Sleeping
        })
        .filter_map(|(_, runtime)| runtime.configured_ram)
        .filter(|gb| gb.is_finite() && *gb > 0.0)
        .sum()
}

/// The heap flags for one start.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::app) struct HeapSettings {
    pub initial_gb: f64,
    pub max_gb: f64,
    /// Add G1 periodic GC so an idle server returns memory (auto + Java 12+).
    pub periodic_uncommit: bool,
}

impl HeapSettings {
    /// Manual mode: the whole heap reserved up front, as before.
    pub fn fixed(ram_gb: f64) -> Self {
        Self {
            initial_gb: ram_gb,
            max_gb: ram_gb,
            periodic_uncommit: false,
        }
    }

    pub fn auto(plan: &AutoRamPlan, java_major: Option<u32>) -> Self {
        Self {
            initial_gb: plan.initial_gb,
            max_gb: plan.cap_gb,
            periodic_uncommit: java_major.is_some_and(|major| major >= PERIODIC_GC_MIN_JAVA),
        }
    }

    /// JVM options, in launch order (`-Xmx` first, matching the old args).
    pub fn jvm_args(&self) -> Vec<String> {
        let mut args = vec![
            format!("-Xmx{}", format_heap_size(self.max_gb)),
            format!("-Xms{}", format_heap_size(self.initial_gb.min(self.max_gb))),
        ];
        if self.periodic_uncommit {
            args.push("-XX:+UseG1GC".to_string());
            args.push(format!(
                "-XX:G1PeriodicGCInterval={PERIODIC_GC_INTERVAL_MS}"
            ));
        }
        args
    }
}

/// Formats a heap size (in gigabytes, fractional allowed) into a JVM size token.
/// Whole gigabytes use the `G` suffix; sub-gigabyte values fall back to `M` so
/// values like 0.5 GB are emitted as `512M` (the JVM rejects fractional `G`).
pub(in crate::app) fn format_heap_size(ram_gb: f64) -> String {
    let megabytes = (ram_gb.max(0.25) * 1024.0).round() as u64;
    if megabytes.is_multiple_of(1024) {
        format!("{}G", megabytes / 1024)
    } else {
        format!("{megabytes}M")
    }
}

/// Human label for console lines, e.g. `4 GB`, `512 MB`.
pub(in crate::app) fn format_ram_label(ram_gb: f64) -> String {
    let megabytes = (ram_gb.max(0.0) * 1024.0).round() as u64;
    if megabytes.is_multiple_of(1024) {
        format!("{} GB", megabytes / 1024)
    } else {
        format!("{megabytes} MB")
    }
}

fn round_to(value: f64, step: f64) -> f64 {
    (value / step).round() * step
}

fn floor_to(value: f64, step: f64) -> f64 {
    (value / step).floor() * step
}

#[cfg(test)]
mod tests {
    use super::*;

    fn footprint(kind: ServerKind) -> ServerFootprint {
        ServerFootprint {
            kind,
            plugin_count: 0,
            mod_count: 0,
            max_players: Some(20),
        }
    }

    #[test]
    fn ram_mode_normalizes_with_a_fallback() {
        assert_eq!(normalize_ram_mode(Some("auto"), RAM_MODE_MANUAL), "auto");
        assert_eq!(
            normalize_ram_mode(Some(" Manual "), RAM_MODE_AUTO),
            "manual"
        );
        assert_eq!(normalize_ram_mode(Some("smart"), RAM_MODE_MANUAL), "manual");
        assert_eq!(normalize_ram_mode(None, RAM_MODE_AUTO), "auto");
        assert!(is_auto_ram_mode(Some("AUTO")));
        assert!(!is_auto_ram_mode(None));
    }

    #[test]
    fn kind_comes_from_the_provider_name() {
        assert_eq!(server_kind("velocity", 0, false), ServerKind::Proxy);
        assert_eq!(server_kind("bungeecord", 0, false), ServerKind::Proxy);
        assert_eq!(server_kind("vanilla", 0, false), ServerKind::Vanilla);
        assert_eq!(server_kind("paper", 0, false), ServerKind::Plugin);
        assert_eq!(server_kind("neoforge", 10, false), ServerKind::Modded);
        assert_eq!(server_kind("fabric", 80, false), ServerKind::Modpack);
        assert_eq!(server_kind("", 0, true), ServerKind::Modpack);
    }

    #[test]
    fn base_estimates_by_kind() {
        assert_eq!(estimate_gb(&footprint(ServerKind::Proxy)), 0.5);
        assert_eq!(estimate_gb(&footprint(ServerKind::Vanilla)), 3.0);
        assert_eq!(estimate_gb(&footprint(ServerKind::Plugin)), 3.0);
        assert_eq!(estimate_gb(&footprint(ServerKind::Modded)), 4.0);
        assert_eq!(estimate_gb(&footprint(ServerKind::Modpack)), 6.0);
    }

    #[test]
    fn content_and_players_add_to_the_estimate() {
        let proxy = ServerFootprint {
            plugin_count: 12,
            ..footprint(ServerKind::Proxy)
        };
        assert_eq!(estimate_gb(&proxy), 1.0);

        let paper = ServerFootprint {
            plugin_count: 31,
            max_players: Some(60),
            ..footprint(ServerKind::Plugin)
        };
        // 3 + 2 × 0.5 (plugins) + 2 × 0.5 (40 extra slots)
        assert_eq!(estimate_gb(&paper), 5.0);

        let modded = ServerFootprint {
            mod_count: 49,
            ..footprint(ServerKind::Modded)
        };
        assert_eq!(estimate_gb(&modded), 4.5);

        let big_pack = ServerFootprint {
            mod_count: 250,
            ..footprint(ServerKind::Modpack)
        };
        assert_eq!(estimate_gb(&big_pack), 9.0);
    }

    #[test]
    fn player_bonus_and_total_are_bounded() {
        let crowded = ServerFootprint {
            max_players: Some(1000),
            ..footprint(ServerKind::Vanilla)
        };
        assert_eq!(estimate_gb(&crowded), 5.0);

        let huge = ServerFootprint {
            mod_count: 2000,
            max_players: Some(1000),
            ..footprint(ServerKind::Modpack)
        };
        assert_eq!(estimate_gb(&huge), MAX_ESTIMATE_GB);
    }

    #[test]
    fn system_cap_keeps_a_reserve_and_subtracts_other_servers() {
        // 16 GB: reserve is max(3, 3.2) = 3.2
        assert!((system_cap_gb(16.0, 0.0) - 12.8).abs() < 1e-9);
        // 8 GB: reserve is the 3 GB floor
        assert!((system_cap_gb(8.0, 2.0) - 3.0).abs() < 1e-9);
    }

    #[test]
    fn plan_uses_the_estimate_when_it_fits() {
        let plan = plan_auto_ram(&footprint(ServerKind::Plugin), 32.0, 0.0);
        assert_eq!(plan.cap_gb, 3.0);
        assert_eq!(plan.initial_gb, 0.75);
        assert!(!plan.exceeds_system_cap);
    }

    #[test]
    fn plan_caps_to_the_machine_and_flags_it() {
        // 8 GB with a 4 GB server already running: 8 − 3 − 4 = 1 GB spare.
        let plan = plan_auto_ram(&footprint(ServerKind::Plugin), 8.0, 4.0);
        assert_eq!(plan.cap_gb, 1.0);
        assert_eq!(plan.initial_gb, 0.25);
        assert!(plan.exceeds_system_cap);
    }

    #[test]
    fn plan_never_goes_below_the_kind_minimum() {
        let plan = plan_auto_ram(&footprint(ServerKind::Modded), 4.0, 8.0);
        assert_eq!(plan.cap_gb, 2.0);
        assert_eq!(plan.system_cap_gb, 0.0);
        assert!(plan.exceeds_system_cap);

        let proxy = plan_auto_ram(&footprint(ServerKind::Proxy), 2.0, 0.0);
        assert_eq!(proxy.cap_gb, 0.5);
        assert_eq!(proxy.initial_gb, 0.25);
    }

    #[test]
    fn initial_heap_is_at_most_one_gigabyte() {
        let plan = plan_auto_ram(&footprint(ServerKind::Modpack), 64.0, 0.0);
        assert_eq!(plan.cap_gb, 6.0);
        assert_eq!(plan.initial_gb, 1.0);
    }

    #[test]
    fn manual_heap_keeps_xms_equal_to_xmx() {
        assert_eq!(
            HeapSettings::fixed(4.0).jvm_args(),
            vec!["-Xmx4G", "-Xms4G"]
        );
        assert_eq!(
            HeapSettings::fixed(0.5).jvm_args(),
            vec!["-Xmx512M", "-Xms512M"]
        );
    }

    #[test]
    fn auto_heap_is_elastic_and_uncommits_on_java_12_plus() {
        let plan = plan_auto_ram(&footprint(ServerKind::Plugin), 32.0, 0.0);
        assert_eq!(
            HeapSettings::auto(&plan, Some(21)).jvm_args(),
            vec![
                "-Xmx3G",
                "-Xms768M",
                "-XX:+UseG1GC",
                "-XX:G1PeriodicGCInterval=60000"
            ]
        );
        // Java 8/11 (or unknown) don't have periodic GC: just the elastic heap.
        assert_eq!(
            HeapSettings::auto(&plan, Some(11)).jvm_args(),
            vec!["-Xmx3G", "-Xms768M"]
        );
        assert_eq!(
            HeapSettings::auto(&plan, None).jvm_args(),
            vec!["-Xmx3G", "-Xms768M"]
        );
    }

    #[test]
    fn footprint_reads_plugins_mods_and_max_players() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path();
        fs::create_dir_all(dir.join("plugins").join("Essentials")).unwrap();
        for name in ["a.jar", "b.JAR", "notes.txt"] {
            fs::write(dir.join("plugins").join(name), b"").unwrap();
        }
        fs::write(dir.join("server.properties"), "max-players=50\n").unwrap();

        let read = read_footprint(Some(dir), "paper", false);
        assert_eq!(read.kind, ServerKind::Plugin);
        assert_eq!(read.plugin_count, 2);
        assert_eq!(read.mod_count, 0);
        assert_eq!(read.max_players, Some(50));

        let missing = read_footprint(None, "fabric", true);
        assert_eq!(missing.kind, ServerKind::Modpack);
        assert_eq!(missing.max_players, None);
    }

    #[test]
    fn heap_labels() {
        assert_eq!(format_heap_size(0.75), "768M");
        assert_eq!(format_ram_label(2.0), "2 GB");
        assert_eq!(format_ram_label(0.5), "512 MB");
    }
}
