---
name: run-debug
description: Run mserve in dev mode and verify a change end-to-end — launching the app, watching the runtime/telemetry events, and finding logs. Use when asked to "run the app", "test this change", "verify it works", or debug runtime/telemetry/terminal behavior.
---

# Run & debug mserve

## Launch dev

```bash
npm install        # first time / after dependency changes
npm run dev        # Vite (port 1420) + Tauri window with HMR
```

- Frontend edits hot-reload. **Rust edits trigger a full backend rebuild** — the
  Tauri window restarts; give it time on first build.
- `npm run dev` is long-running; start it in the background and keep working, or
  use the project's `/run` skill which already knows how to launch this app.
- There's **no headless/test harness** — verification here means driving the real
  UI and watching events.

## What to watch (the runtime event stream)

Server status is event-driven. When verifying a runtime change, follow these
backend → frontend events:

| Event | Emitted by | Tells you |
| --- | --- | --- |
| `server-runtime-state` | `support/supervisor.rs` | lifecycle: `offline → starting → online → stopping → crashed` / `running-external` |
| `server-telemetry` | `support/supervisor.rs` | a metrics sample (players, TPS, CPU, RAM, uptime) |
| `server-output` | `support/runtime_io.rs` | a console line (also shown in the in-app terminal) |
| `java-download-progress` | `commands/java_download.rs` | JDK download % |

Frontend listeners: `components/server-runtime-monitor.tsx` (app-wide) and
`pages/server/hooks/use-server-runtime.ts` (detail page). To trace an event,
add a temporary `console.log` in the listener and read the webview devtools
console (right-click → Inspect in the Tauri dev window).

## Typical verification recipes

- **Start/stop change:** create or import a server, hit Start, confirm the status
  chip walks `starting → online`; check the terminal tab streams console lines;
  Stop and confirm graceful shutdown (supervisor waits ~10s before force-kill).
- **Telemetry/stats change:** with a server online, open the Statistics tab — live
  samples come over `server-telemetry`; history comes from the SQLite store via
  `get_server_telemetry_history`. TPS only shows for Paper (`/tps`) or TickQuery.
- **Config/settings change:** edit settings, confirm `mserve.json` in the server's
  directory updates and the `update_server_settings` command succeeded (no toast error).

## Where state/logs live

- Per-server config: `mserve.json` inside each server directory.
- Telemetry DB: `telemetry.db` in the app data dir.
- Frontend state: `localStorage` keys `mserve.servers.v4`, `mserve.networks.v1`,
  `mserve.user.v1` (inspect via devtools → Application).
- Backend `eprintln!`/panics surface in the terminal running `npm run dev`.

## Before calling it done
- `npm run build` (typecheck) and, for backend changes, `cargo check` +
  `cargo clippy` (in `src-tauri/`) are clean.
