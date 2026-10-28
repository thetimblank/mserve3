# src-tauri/CLAUDE.md — Rust backend

Backend-specific guidance. See the root [CLAUDE.md](../CLAUDE.md) for project-wide
conventions (IPC contract, events, release rule).

## Build prerequisites

The playit.gg tunneling feature embeds `playit-agent-core`, which pulls
`rustls` → `ring`. `ring` compiles assembly at build time and needs a C
toolchain on Windows: **clang/LLVM on `aarch64`** (`winget install LLVM.LLVM`,
which puts `clang` on PATH) and **`nasm` on `x86_64`**. Without it `cargo
build`/`check` fails in `ring`'s build script with a `failed to find tool
"clang"` (or `nasm`) error. This is the one non-`rustup` build dependency.

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
│   ├── runtime.rs        start/stop/sleep/restart/force-kill, send command, runtime snapshot,
│   │                     background mode, set/get_server_tunnel, delete_server
│   ├── setup.rs          initialize/import a server, sync & repair mserve.json
│   ├── providers.rs      list/resolve provider versions (+ the cached-fetch and Fabric
│   │                     helpers that modrinth.rs/modpack.rs reuse)
│   ├── java.rs           detect_java_runtimes (registry/PATH/JAVA_HOME scan)
│   ├── java_download.rs   download_java_runtime (+ java-download-progress event)
│   ├── network.rs        firewall port forwarding (per-OS dispatch), local/public IP,
│   │                     validate_path, get_system_memory_gb, download_server_jar
│   │                     (+ server-jar-download-progress event)
│   ├── networks.rs       networks.json + per-server network file (Velocity forwarding)
│   ├── settings.rs       update_server_settings / backup settings, Java + custom flags,
│   │                     default servers root
│   ├── backups.rs        create/restore/delete/lock backups, apply retention
│   ├── items.rs          plugin/world/datapack scan, toggle, delete, export, upload, storage
│   ├── config_files.rs   scan/read/write managed config files (whitelist.json, ops.json…)
│   ├── modrinth.rs       Modrinth search/project/versions/tags, install_modrinth_file
│   ├── modpack.rs        install_modrinth_modpack (.mrpack, + modpack-install-progress)
│   ├── telemetry.rs      get_server_telemetry_history
│   ├── playit.rs         playit.gg account: get_playit_status, start_playit_claim, disconnect
│   └── navigation.rs     open_server_folder, open_server_path
└── support/          # subsystems & helpers (not directly exposed to the frontend)
    ├── supervisor.rs      per-server lifecycle owner (see below)
    ├── telemetry.rs       live sample collection (SLP + RCON TPS + sysinfo)
    ├── telemetry_store.rs  SQLite time-series (append + bucket-averaged range query)
    ├── mserve_config.rs   mserve.json read/normalize/write (atomic), provider inference
    ├── server_properties.rs  server.properties read/update, RCON provisioning
    ├── rcon.rs            hand-rolled Source RCON client
    ├── mc_protocol.rs     Minecraft VarInt/String codec, handshake + status packets
    ├── sleep_listener.rs  sleep-mode wake listener (holds the port, answers pings, wakes on join)
    ├── content_meta.rs    .mserve-content.json provenance sidecar for installed content
    ├── download.rs        HTTP client, per-user scratch dir (not /tmp on Linux), verified
    │                      streaming download that removes partial files
    ├── playit.rs          playit.gg tunneling: REST claim/tunnel + in-process agent
    │                      (set_server_tunnel/get_server_tunnel live in commands/runtime.rs;
    │                      emits playit-claim-state + playit-tunnel-state)
    ├── runtime_io.rs      stream child stdout/stderr → server-output events, stdin writes
    ├── process.rs         OS process plumbing (job object / process groups, port→PID kill)
    ├── backups.rs         backup copy/restore + retention enforcement
    ├── auto_backup.rs     automatic backups the supervisor triggers (on start/close,
    │                      interval); emits server-backups-changed
    ├── scan.rs            enumerate worlds/plugins/datapacks
    ├── items.rs           move items between active/inactive folders
    ├── core.rs            platform helpers (no_window_command, home_dir, file moves)
    ├── testkit.rs         test-only fake Minecraft server (SLP + RCON), cfg(test)
    ├── linux_firewall.rs  firewalld/ufw wrappers via pkexec (cfg(linux))
    └── windows_firewall.rs  netsh wrappers (cfg(windows))
```

## Adding / registering a command

1. Write `#[tauri::command] fn my_command(...) -> Result<T, String>` in the right
   `commands/*.rs` (group by domain, not alphabetically).
2. Make it reachable through the `commands` module (modules are re-exported; follow
   the sibling functions in that file).
3. **Register it in the `generate_handler![…]` list at the end of `app/mod.rs`** (in `run()`) —
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
  before force-kill. It also triggers the automatic backups: on start (starting →
  online), on close (after a graceful stop, crash or sleep, never a force-kill)
  and on an interval while online, reading the modes from mserve.json each time.
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
- Run `cargo fmt` and `cargo clippy` before considering a backend change done.
  CI (and the `pre-push` hook) fail on `cargo fmt --check` and on
  `cargo clippy --all-targets -- -D warnings`.
- **Slow work off the main thread:** synchronous `#[tauri::command]`s run on the
  main thread. A command that spawns processes, probes ports, talks RCON, or waits
  must be `async` and wrap that work in `spawn_blocking` (see `run_blocking` in
  `commands.rs`).
- **Downloads:** go through `support/download.rs` (`http_client`, `download_to_file`,
  `scratch_dir`). Pass the provider's published hash as a `Checksum` whenever there is
  one, and never stage files under a bare `std::env::temp_dir()`.
