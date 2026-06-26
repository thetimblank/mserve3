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

(May not be up-to-date, in-order from most to least important)

### v4

- major cleanup of backend (rust & typescript hidden logic/sturcture) code/performance optimizations, simple and reusable, delete uneeded normalizations, debloat, etc.
- linux support
- error reporting and feedback
- minimize to background (minimal footprint)
- setup networks and server groups
- in-app plugin and modpack browser
- remote start (SSH?)
- rework backup system
- --nogui will be forced when not in advanced mode
- let others connect to your mserve
- add tunneling instead of just port forwarding
- server logs
- server crashed state
- add tab completion to terminal
- more help pages and explanations
- sleep mode
- rework MC settings for non-advanced users
- onboarding if needed. (advanced/beginner, theme, etc)
- move help pages below servers in sidebar

Bugs

- memory of mserve goes up every time server is launched, and never decreases until app is restarted
- overflow of hover effect on dashboard in the most used category's cards
- port not showing correctly/at all in the connect widget in a server's overview page

Supported Providers

- Modpack servers
- Modded servers (Forge, Fabric, Neoforge)
- Bungee
- Spigot
- Pufferfish
- Purpur
- Waterfall

---

### v5

- advanced statistics systems (plugins/jvm, etc to track stats instead of v3/v4 system)
- change plugin settings?
- accounts?
- webapp?
- rehaul UI
