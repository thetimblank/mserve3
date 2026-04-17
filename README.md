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

✅ OTA updates
✅ read from mserve.json
✅ remove server from app
✅ smoother side bar animation
🟨 auto fetch all mc server jars [BETA]
🟨 Repairing servers does not work correctly at the moment
🟨 add clearing backups, storage limit, & interval clearing
⬛ read minecraft settings (properties, ops, whitelist, etc.)
⬛ validate/fix issues with other server jars/parsing, make way to add new jars
⬛ update server
⬛ setup proxies and server groups
⬛ motd generator
⬛ more settings
⬛ add statistics of players joined, uptime, etc.
⬛ modded servers?
⬛ change plugin settings?
⬛ accounts and remote start on website?
