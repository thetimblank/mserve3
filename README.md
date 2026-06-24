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
🟨 add graphs & data on players, uptime %, ram usage, cpu usage
⬛ Please add a complete and thourough system to test.
Testing should cover all types of starting, stopping, different versions, custom jars, modded servers, telementry, etc. Think about what else testing should cover.

It should be robust and actually valuable to catch bugs from and run before prod after each change, it should be scalable.

You may use any packages that could assist with this.

Help me out here, because i am not too familiar with testing, so what is good here? Ask questions as needed.
⬛ Your task is to implement a full server updating system.

1. Please add a update server that will automatically also check if there is an update available for servers. 2. Add an option to disable this in global settings.
2. It should check for updates on each server when mserve loads, do not notify the user, simply add an update available text in each server's jar section and a check for updates button.
3. Use the same/similar UI to the apps overall updater.
4. If it changes a major MC version, please warn the user before updating (after clicking the update button) that this may have unwanted effects that include data loss or corruption via a modal, add a cancel button, proceed button, and a backup & proceed button.

Think of anything else that could be good here. Ask questions as needed.

🚩 When java version is set as automatic, and the java version isnt detected
🚩 Fix motd not working. Users Cannot save file once the MOTD is changed.
⬛ Increase base sizing of console (when window's height is not enough, it disappears)
🚩 Revamp Overview UI
⬛ hide loading... in the blurred IP address behind the blur
⬛ In /server/[slug]/overview:

1. Remove the cards where ther is no data available (E.g. TPS card on servers that dont support TPS). (Keep all cards in /server/[slug]/statistics)
2. when advanced mode is ON, display ram as "XX.X% ...mb/...mb" rather than just the "XX.X%" on cards (both /overview & /statistics)

Supported Providers
Test & support all providers thoroughly
🟨 Velocity
🟨 Paper
🟨 Folia
🟨 Vanilla

**v4**
⬛ linux support!!!
⬛ onboarding if needed. (advanced/beginner, theme, etc)
⬛ major cleanup of backend (rust & typescript) code/performance optimizations, simple and reusable, delete uneeded normalizations, etc.
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
