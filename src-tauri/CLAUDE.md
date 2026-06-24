# src-tauri/CLAUDE.md — Rust backend

Backend-specific guidance. See the root [CLAUDE.md](../CLAUDE.md) for project-wide
conventions (IPC contract, events, release rule).

## Entry path

`src/main.rs` (GUI entry, no console) → `src/lib.rs::run()` → `src/app/mod.rs`
(the Tauri builder: registers state, plugins, and the command handler, then runs).

`main.rs` is intentionally thin so Windows doesn't pop a console window; all real
setup is in `app/mod.rs`.

## Module layout

```
src/app/
├── mod.rs            # Tauri builder, managed state, struct/enum definitions, generate_handler!
├── commands/         # #[tauri::command] IPC handlers — the frontend-facing API
│   ├── runtime.rs        start/stop/restart/force-kill, send command, get runtime snapshot
│   ├── setup.rs          initialize/import/inspect a server, sync & repair mserve.json
│   ├── providers.rs      list/resolve provider versions, download_server_jar
│   ├── java.rs           detect_java_runtimes (registry/PATH/JAVA_HOME scan)
│   ├── java_download.rs   download_java_runtime (+ java-download-progress event)
│   ├── network.rs        firewall port forwarding (netsh)
│   ├── networks.rs       networks.json + per-server network file (Velocity forwarding)
│   ├── settings.rs       update_server_settings, set_server_java_installation
│   ├── backups.rs        create/restore/delete backup
│   ├── items.rs          plugin/world/datapack toggle, delete, export, upload
│   ├── config_files.rs   scan/read/write managed config files (whitelist.json, ops.json…)
│   ├── telemetry.rs      get_server_telemetry, get_server_telemetry_history
│   └── navigation.rs     open folder/path, validate_path, delete_server
└── support/          # subsystems & helpers (not directly exposed to the frontend)
    ├── supervisor.rs      per-server lifecycle owner (see below)
    ├── telemetry.rs       live sample collection (SLP + RCON TPS + sysinfo)
    ├── telemetry_store.rs  SQLite time-series (append + bucket-averaged range query)
    ├── mserve_config.rs   mserve.json read/normalize/write, provider inference
    ├── server_properties.rs  RCON provisioning into server.properties
    ├── rcon.rs            hand-rolled Source RCON client (loopback only)
    ├── runtime_io.rs      stream child stdout/stderr → server-output events
    ├── backups.rs         backup copy/restore + retention enforcement
    ├── scan.rs            enumerate worlds/plugins/datapacks
    ├── items.rs           move items between active/inactive folders
    ├── core.rs            platform helpers (no_window_command, home_dir, file moves)
    └── windows_firewall.rs  netsh wrappers
```

## Adding / registering a command

1. Write `#[tauri::command] fn my_command(...) -> Result<T, String>` in the right
   `commands/*.rs` (group by domain, not alphabetically).
2. Make it reachable through the `commands` module (modules are re-exported; follow
   the sibling functions in that file).
3. **Register it in the `generate_handler![…]` list in `app/mod.rs`** (~line 546) —
   this is the step that's easy to forget; an unregistered command fails at runtime
   with "command not found", not at compile time.
4. Frontend side: `invoke('my_command', { camelCaseArgs })`. See the
   **add-tauri-command** skill for the full walkthrough.

## State model

```rust
// Managed via .manage() in app/mod.rs, injected as State<RuntimeState>.
struct RuntimeState { processes: Arc<Mutex<HashMap<String, ServerRuntime>>> }
```

- The map is **keyed by the server's directory path** (not its id), so an imported
  server re-using a directory resolves to the same runtime.
- `ServerRuntime` holds the `Child`, stdin, pid, `LifecycleState`, an stderr tail
  ring-buffer, RCON config, port/proxy flags, the latest `TelemetrySample`, and a
  monotonic `generation: u64`.
- **Locking invariant:** holds of the `processes` mutex are *brief* — snapshot,
  mutate, emit, release. The long-running poll/telemetry loop lives in the
  supervisor thread and does **not** hold the lock while sleeping or doing I/O.
- **`generation` token** guards against a stale supervisor (from a previous
  start/restart) overwriting state after a new one has taken over.

## Subsystems worth knowing

- **supervisor** (`support/supervisor.rs`): one thread per started/adopted server.
  Owns lifecycle — watches the child for exit, probes the TCP port to flip
  `starting → online`, drives telemetry sampling cadence (~1s starting, ~5s online),
  and emits `server-runtime-state` + `server-telemetry`. Graceful stop waits ~10s
  before force-kill.
- **telemetry** (`support/telemetry.rs`): builds a `TelemetrySample` from three
  sources — Server-List-Ping (online/players/version/MOTD, works for proxies),
  RCON TPS (`/tps` for Paper, `/tickquery` for the TickQuery plugin, else
  unsupported — detection is cached in `TpsCommandState`), and `sysinfo` (CPU/RAM).
  Missing sources are simply omitted, never faked.
- **telemetry_store** (`support/telemetry_store.rs`): SQLite (`telemetry.db` in app
  data dir), single mutex-guarded connection. Appends samples, prunes to 30 days,
  and `query_range()` returns bucket-averaged points for charting.

## Conventions

- **Errors:** commands return `Result<T, String>`. For non-critical paths
  (telemetry, best-effort cleanup) prefer `.ok()` / `.unwrap_or_default()` over
  propagating — a failed metric must never crash a start.
- **Serde:** boundary structs use `#[serde(rename_all = "camelCase")]`; serialized
  enums (lifecycle, etc.) use `kebab-case`. Match the existing derive on neighbors.
- **Processes:** spawn through `core::no_window_command()` so no console window
  flashes on Windows.
- **Paths:** canonicalize (the code uses `dunce` to avoid UNC weirdness) and
  validate that a resolved path stays under its expected root before touching files
  (traversal guard) — see `scan.rs` / `items.rs`.
- **Idempotent writes:** read → compare → write only on change (e.g. RCON
  provisioning in `server_properties.rs`).
- Run `cargo fmt` and `cargo clippy` before considering a backend change done
  (no CI lint gate exists, so this is on you).
