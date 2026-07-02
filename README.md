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

- ~~full Linux support (firewall via firewalld/ufw, Java detection/download, process management, .deb/.rpm/AppImage releases + updater)~~ ✅
- add smarter error reporting and feedback
- fully finish and clean up the "setup networks" page. it should have all the features users should expect and work flawlessly. clean up the UI to be more intuitive as well.
- ~~add a full in-app plugin and modpack browser similar to prism launcher. (Modrinth browser for plugins/mods/datapacks in the server tabs + modpack installs in the create wizard, incl. Fabric/Forge/NeoForge server support)~~ ✅
- rework backup system to have all of the features the user would expect, e.g. different retention policies, better/smart limits, etc.
- add tunneling instead of just port forwarding
- better statistics in home page, something more useful and something like "insights"
- server crashed state and crash protection
- server bot protection and enhance security
- add tab completion to terminal
- more help pages and explanations (think of features normal users may be confused about, also add page to just have like "I want a survival SMP" and auto-prefill settings [might be good for onboarding], etc.)
- sleep mode and settings controlling sleep mode. (like when no more users are logged in afte X time, also auto boot up when someone joins, etc)
- rework MC settings for non-advanced users (Like the server.properties, velocity.toml, etc. make these more user friendly for non-advanced users)
- onboarding if needed. (advanced/beginner, theme, what is goal, etc)
- ~~move help pages below servers in sidebar~~✅
- make --nogui forced when not in advanced mode (?)

Bugs/Fixes

- Ram not showing up on modpack screen
- Auto-java detection not working on stuff like 26.1.2 (Uses J17, then J21, but never gets to J25.) Also, J17 is just wrong for this, not sure why it shows that for 26.1.2
- 25565 not hidden for server IP on server overview panel. (Only hide this port since its redundant in MC.)
- add same active effect to other app sidebar pages that is shown for each server. (solid purple when on the page)

Supported Providers

- Modpack servers ✅
- Modded servers (Forge, Fabric, Neoforge) ✅
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
- remote start (SSH?)
- let others connect to your mserve
