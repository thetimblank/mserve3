# mserve

a webapp tool that helps manage and setup minecraft servers easily with full customizations.

mserve is a Tauri + React desktop app for end-to-end Minecraft server management: it lets users create or import servers, run a guided setup flow (directory, jar, RAM, backups, auto-restart), control server runtime with start/stop/restart plus terminal access, manage server contents (plugins, worlds, datapacks, backups, provider-aware settings), run a Java compatibility guide that detects installed runtimes and checks them against server requirements, and use a hosting setup wizard for firewall/port-forwarding and connection basics; it also includes data repair/sync for mserve.json and in-app update handling.

## Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Releasing OTA updates

This project now uses the Tauri updater plugin.

## 1) Version bump rule

Always bump app version before building a release:

- `package.json` -> `version`
- `src-tauri/Cargo.toml` -> `version`
- `src-tauri/tauri.conf.json` -> `version`

Use the same semantic version across all three files.

## 2) Build release artifacts

```bash
npm install
npm run release:build
```

## 3) Where to publish

Publish to your repository Releases page:

- <https://github.com/thetimblank/mserve3/releases>

Create a release tag like `v3.3.0`, then upload all files above as assets.

With your updater endpoint, users will always read `latest.json` from the latest release asset URL.

## Roadmap

### Version

**Stable versions:**
v(major feature update).(minor feature update).(patch/fix update)
e.g. v3.3.0

**Unstable Versions:**
v(major feature update).(minor feature update).(patch/fix update)pre(subpatch/fix)
e.g. v4.0.12pre0

### Checklist

(May not be up-to-date)
**v3**
🟨 setup networks and server groups

1. Automatically total max players of the children and set this as the max players of the proxy

⬛ Fix motd not working.

1. Users Cannot save file once the MOTD is changed.
2. ⬛ Improve MOTD editor.

Supported Providers
Test & support all providers thoroughly
🟨 Velocity
🟨 Paper
🟨 Folia
🟨 Vanilla

**v4**
⬛ linux support!!!
⬛ more help pages and explanations
⬛ onboarding if needed. (advanced/beginner, theme, etc)
⬛ major cleanup of backend (rust & typescript hidden logic/sturcture) code/performance optimizations, simple and reusable, delete uneeded normalizations, etc.
⬛ add tab completion to terminal
⬛ rehaul UI
⬛ advanced statistics systems (plugins, etc to track stats instead of v3 system)

Supported Providers
⬛ Modded servers
⬛ Spigot
⬛ Bungee

**Future**
⬛ change plugin settings?
⬛ accounts and remote start on website?
