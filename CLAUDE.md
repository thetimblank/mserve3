# CLAUDE.md

Guidance for Claude (and humans) working in this repo. Read this first; the
nested `src-tauri/CLAUDE.md` and `src/CLAUDE.md` go deeper when you're in those
trees.

## What this is

**mserve** is a desktop app for end-to-end Minecraft server management: create or
import servers, run a guided setup (directory → jar → RAM → backups → auto-restart),
control runtime (start/stop/restart + live terminal), manage contents (plugins,
worlds, datapacks, backups), check Java compatibility, and orchestrate multi-server
networks.

- **Shell:** [Tauri 2.10](https://tauri.app/) (Rust backend + webview frontend)
- **Frontend:** React 18 + TypeScript (strict) + Vite 6 + Tailwind 4 + shadcn/ui (Radix), React Router 7, Context for state
- **Backend:** Rust (edition 2024), SQLite via `rusqlite` (telemetry time-series), `reqwest`, `sysinfo`, hand-rolled RCON + Server-List-Ping
- **Platform:** **Windows-only today** (uses `netsh` firewall, `CREATE_NO_WINDOW`, registry Java scan). Linux is a v4 goal — don't assume cross-platform.

## Commands

Run from the repo root unless noted. **There is no test suite and no linter
config** — don't invent `npm test`/`npm run lint`; they don't exist yet.

| Task | Command |
| --- | --- |
| Install deps | `npm install` |
| Dev (Vite + Tauri window, HMR) | `npm run dev` — Vite on `1420`, HMR on `1421` |
| Frontend typecheck + build | `npm run build` (`tsc && vite build`) |
| Release build (signed installers) | `npm run release:build` |
| Backend compile check | `cargo check` *(run inside `src-tauri/`)* |
| Backend lint / format | `cargo clippy` / `cargo fmt` *(inside `src-tauri/`)* |

For verifying a runtime change end-to-end, see the **run-debug** skill.

## Repo map

| Path | What's there |
| --- | --- |
| [src/](src/) | React/TS frontend — see [src/CLAUDE.md](src/CLAUDE.md) |
| [src-tauri/](src-tauri/) | Rust/Tauri backend — see [src-tauri/CLAUDE.md](src-tauri/CLAUDE.md) |
| [src-tauri/src/app/commands/](src-tauri/src/app/commands/) | Tauri IPC handlers (the API the frontend calls) |
| [src-tauri/src/app/support/](src-tauri/src/app/support/) | Backend subsystems (supervisor, telemetry, rcon, backups…) |
| [src/data/](src/data/) | React Context stores (servers, networks, user, java) |
| [src/lib/](src/lib/) | Frontend services, schemas, mappers |
| [docs/ai prompts/](docs/ai%20prompts/) | Reusable task-template prompts (`add` / `fix` / `rework`) |
| [README.md](README.md) | Human landing page + roadmap + release publishing steps |
| `.claude/skills/` | Workflow skills (release, add-tauri-command, add-provider, run-debug) |

## Critical conventions & gotchas

- **Releasing = bump version in THREE files to the same semver:**
  [package.json](package.json) `version`, [src-tauri/Cargo.toml](src-tauri/Cargo.toml)
  `version`, [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) `version`.
  Forgetting one breaks the OTA updater (`latest.json` derives from
  `tauri.conf.json`). Use the **release** skill. CI (`.github/workflows/release-tauri.yml`)
  fires on a pushed `v*` tag.
- **IPC contract:** every `#[tauri::command]` returns `Result<T, String>` (errors
  become plain strings on the JS side). Structs crossing the boundary use
  `#[serde(rename_all = "camelCase")]`, so Rust `snake_case` fields arrive as
  `camelCase` in TS. Command *names* invoked from JS stay `snake_case`
  (e.g. `invoke('start_server', …)`).
- **Lifecycle states** (serialized `kebab-case`): `offline`, `starting`, `online`,
  `stopping`, `crashed`, `running-external`. This — not console scraping — is the
  authoritative server status, set by the supervisor via TCP port probing.
- **Backend → frontend events** (4 of them):
  - `server-runtime-state` — lifecycle change (emitted by `support/supervisor.rs`)
  - `server-telemetry` — a metrics sample (`support/supervisor.rs`)
  - `server-output` — a stdout/stderr console line (`support/runtime_io.rs`)
  - `java-download-progress` — JDK download % (`commands/java_download.rs`)
- **Per-server config lives in `mserve.json`** in each server's directory (RAM,
  flags, provider, java path, backup policy…). The frontend mirrors a subset to
  `localStorage`; the backend owns the file. See `support/mserve_config.rs`.
- **RCON is auto-provisioned:** on start, mserve writes `enable-rcon=true` + a
  random port/password into `server.properties` (loopback only). Telemetry/commands
  ride RCON + Server-List-Ping.
- **Java is explicit:** servers store an absolute path to the `java` binary. There
  is intentionally **no bare-`java` fallback** — a missing/incompatible runtime is a
  hard error, surfaced to the user.

## How to find things

- New IPC method? → **add-tauri-command** skill.
- New/extended server provider (Paper/Velocity/…)? → **add-provider** skill.
- Running and watching events/logs? → **run-debug** skill.
- Task templates the user likes to start from live in [docs/ai prompts/](docs/ai%20prompts/);
  they end with "ask questions or protest if something could be implemented better" —
  honor that: push back when you see a better design.
