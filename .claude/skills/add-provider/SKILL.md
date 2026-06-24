---
name: add-provider
description: Add or extend support for a Minecraft server provider (Paper, Velocity, Vanilla, Folia, Spigot, modded, …) — jar resolution, capabilities, telemetry, and config normalization. Use when the user wants to "support a new provider", "add Folia/Spigot/modded", or change how a provider's jars/capabilities work.
---

# Add / extend a server provider

A "provider" is the server flavor (Paper, Velocity, Vanilla…). Support spans the
Rust backend (where jars come from, what telemetry works) and the frontend (which
tabs/capabilities show). Touch each layer that applies.

## Concepts to know first

- Each server records its provider in `mserve.json` as `MserveProvider`
  (`name`, `file`, `download_url?`, `provider_version`, `minecraft_version`,
  `jdk_versions`, `supported_telemetry`, `stable`) — defined in
  [src-tauri/src/app/mod.rs](../../../src-tauri/src/app/mod.rs).
- Providers fall into a **`kind`** on the frontend (`plugin` | `vanilla` | proxy)
  that drives capabilities — see `resolvedCatalog.kind` usage in
  [src/lib/server-provider-capabilities.ts](../../../src/lib/server-provider-capabilities.ts).
- Proxies (Velocity/Bungee) have **no RCON and no worlds/plugins-as-jars** the way
  game servers do — telemetry is Server-List-Ping only.

## 1. Jar resolution (backend)

[src-tauri/src/app/commands/providers.rs](../../../src-tauri/src/app/commands/providers.rs)
resolves and downloads jars. Paper-family projects come from the Fill API
(`fill_list_entries` / `resolve_fill`); Vanilla has its own
`resolve_*_vanilla` path with a cached manifest. To add a provider:
- Add its listing + resolution path (reuse `fetch_cached` for HTTP + disk cache
  with TTL and stale-offline fallback).
- Return entries with the correct `minecraft_version` (note Velocity's version
  handling differs — see the `project == "velocity"` branches).

## 2. Config normalization (backend)

[src-tauri/src/app/support/mserve_config.rs](../../../src-tauri/src/app/support/mserve_config.rs)
infers/normalizes the provider (including from a jar filename) and sets defaults.
Add inference + sensible `jdk_versions` / `supported_telemetry` / `stable` defaults
for the new provider here.

## 3. Telemetry support (backend)

If the provider supports a TPS command, account for it in
[src-tauri/src/app/support/telemetry.rs](../../../src-tauri/src/app/support/telemetry.rs)
(`TpsCommandState`: Paper `/tps`, TickQuery `/tickquery`, else Unsupported).
Proxies should be flagged so the supervisor uses SLP-only and skips RCON.

## 4. Capabilities & UI (frontend)

In [src/lib/server-provider-capabilities.ts](../../../src/lib/server-provider-capabilities.ts)
map the provider to its `kind` and capability flags (which tabs appear, whether
EULA auto-agree applies, etc.). Related provider logic lives in
`src/lib/server-provider.ts`. Verify the creation wizard
(`src/pages/create-server/`) offers the provider.

## Verify
- Resolve + download a jar for the new provider through the create flow.
- `cargo check` + `npm run build` pass.
- Start a server of that provider and confirm telemetry/tabs behave (see
  **run-debug**). Cross-check against the README "Supported Providers" list and
  update it if the user wants.
