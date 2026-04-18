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
✅ OTA updates
✅ read from mserve.json
✅ remove server from app
✅ smoother side bar animation
✅ add statistics of players joined, uptime, etc.
🟨 validate/fix issues with other server jars/parsing, make way to add new jars
🟨 add clearing backups, storage limit, & interval clearing
🟨 Repairing servers needs to be tested
🟨 auto fetch all mc server jars [BETA]
⬛ read minecraft settings (properties, ops, whitelist, etc.)
⬛ update server
⬛ restyle server settings & enable users to change server provider
⬛ redo and set permanent storage solution for user/app settings
⬛ fix uptime updating on tab switches and state changes, rather automatically
⬛ setup proxies and server groups
⬛ motd generator
⬛ onboarding/welcome screen
⬛ better explaination of hosting setup
⬛ cleanup and better use of terminal UX and UI
⬛ add tab completion to terminal
⬛ more settings
⬛ add robust logging
⬛ add graphs & data on players, uptime %, ram usage, cpu usage
⬛ better the integration of tps detection and version detection.
⬛ make unique properties editable
⬛ modded servers?
⬛ change plugin settings?
⬛ accounts and remote start on website?
