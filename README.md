# mserve

a webapp tool that helps manage and setup minecraft servers easily with full customizations.

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
Big
✅ OTA updates
✅ read from mserve.json
✅ rewrite & cleanup of backend code.
✅ splash screen
🟨 test & support all providers thoroughly
🟨 auto fetch provider server jars [BETA]
⬛ add testing!!!
⬛ inform user & read minecraft settings (properties, ops, whitelist, etc.)
⬛ update server
⬛ inform user about proper java versions
⬛ motd generator
⬛ add docs
⬛ onboarding/welcome screen

Small
🟨 better explaination of hosting setup and integrate with server specific ports/ip
⬛ better integration of version detection

Supported Providers
🟨 Velocity
🟨 Paper
🟨 Folia
🟨 Vanilla

**v4**
⬛ linux support!!!
⬛ setup networks and server groups
⬛ cleanup of backend code/performance optimizations
⬛ add tab completion to terminal
⬛ add graphs & data on players, uptime %, ram usage, cpu usage
⬛ rehaul UI (number input)
⬛ advanced statistics systems (plugins, etc to track stats instead of v3 system)

Supported Providers
⬛ Modded servers
⬛ Spigot
⬛ Bungee

**Future**
⬛ change plugin settings?
⬛ accounts and remote start on website?
