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

Using semver `vmajor.minor.fix` e.g. `v4.0.12`

### Checklist

(May not be up-to-date, in-order from most to least important)

### v4

- rework MC settings for non-advanced users (Like the server.properties, velocity.toml, etc. make these more user friendly for non-advanced users)
- relocate some settings to better match the function, e.g. backups settings are now in the backups tab.

- improve current help pages and maybe add some more smaller ones
- improve some UI like the plugins, datapacks, and backups pages, and more
- clean up all of the animations
- Verify error reporting

Bugs

- Add &r at end of the first line/content to fix motd formatting
- Better sleeping UX for player (Works, but server says its stopped and doesnt ping at all while its waking/starting)
- When a server is on, the backup settings restore to default (remove all saved changes) every couple of seconds

Supported Providers

- ~~Modpack servers~~ ✅
- ~~Modded servers (Forge, Fabric, Neoforge)~~ ✅
- ~~Bungee~~ ✅
- Spigot (import/detection only — no redistributable jar; requires BuildTools)
- ~~Purpur~~ ✅

---

### v5

- add tab completion to terminal using plugins/mods and matrix for vanilla
- advanced statistics systems (plugins/jvm, etc to track stats instead of v3/v4 system)
- change plugin settings?
- accounts?
- webapp?
- rehaul UI
- remote start (SSH?)
- let others connect to your mserve
