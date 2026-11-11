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

- Verify error reporting

Bugs

- Add &r at end of the first line/content to fix motd formatting

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

---

### Potential future features

Ideas from the UX rehaul planning ([docs/rehaul/](docs/rehaul/README.md)) that were
deliberately left out for now.

**Automatic port-forward check.** The hosting guide currently asks the user to test
with a friend. An automated check needs a vantage point outside the user's network,
because testing your own public IP from inside it is unreliable (many routers don't
loop back). mserve can answer the test itself with its existing Server List Ping
responder (the sleep-mode wake listener), so no real server has to run. Options:

- mcsrvstat.us API: free, but sends the user's public IP to a third party and caches
  results for a few minutes.
- A small Cloudflare Worker we host that opens a TCP connection to `ip:port`: we
  control it, and it could also back other relay features.
- UPnP (crate such as `igd-next`): let mserve open the port automatically on routers
  that allow it. It can only see mappings it created itself, and some users disable
  UPnP on purpose, so this would be opt-in.

**Feedback without a GitHub account (Sentry User Feedback).** Sentry is already
wired in (`src/lib/sentry.ts`, opt-in via `VITE_SENTRY_DSN`). `Sentry.captureFeedback`
would send a message (plus an optional email) to the Sentry dashboard with email
alerts, so players without GitHub can report bugs. Security notes:

- The DSN only allows *sending* events. It can't read, change, or delete anything,
  and Sentry intends it to ship inside client apps. That's why it's safer than a
  Discord webhook (which lets anyone post into the server).
- Main risk: someone who extracts the DSN can send junk reports and use up quota.
  Mitigate with per-key rate limits, spike protection, and inbound filters in the
  Sentry project settings.
- Privacy: feedback text is stored by Sentry. Keep `sendDefaultPii: false` and the
  existing home-directory scrubbing, keep email optional, and tell the user what is
  sent. Release builds need `VITE_SENTRY_DSN` set as a CI secret; builds without it
  fall back to the GitHub link.

**IPv6 address for advanced users.** Show the public IPv6 as a secondary address.
IPv4 stays primary: about half of internet connections still lack IPv6, and Windows
rotates temporary IPv6 addresses.

**Player actions for Standard/Advanced.** The beginner player-actions panel could
become an optional panel for the other tiers.
