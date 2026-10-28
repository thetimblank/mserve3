# mserve

a desktop app that helps manage and set up minecraft servers easily with full customization.

mserve is a Tauri + React desktop app for end-to-end Minecraft server management: it lets users create or import servers, run a guided setup flow (directory, jar, RAM, backups, auto-restart), control server runtime with start/stop/restart plus terminal access, manage server contents (plugins, worlds, datapacks, backups, provider-aware settings), run a Java compatibility guide that detects installed runtimes and checks them against server requirements, and use a hosting setup wizard for firewall/port-forwarding and connection basics; it also includes data repair/sync for mserve.json and in-app update handling.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Development

```bash
npm install
npm run tauri dev   # Vite + Tauri window with HMR
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/testing.md](docs/testing.md).

## Releasing OTA updates

mserve updates itself through the Tauri updater plugin, which reads `latest.json`
from the latest GitHub release.

1. Bump `version` to the same semver in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`.
2. Push a matching tag (e.g. `v3.6.0`).

The [release workflow](.github/workflows/release-tauri.yml) checks the tag matches the
three files, builds and signs the Windows and Linux installers, uploads them to the
[Releases page](https://github.com/thetimblank/mserve3/releases), and publishes
`latest.json`. Don't upload assets by hand: a release without `latest.json` is
invisible to the updater.

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
