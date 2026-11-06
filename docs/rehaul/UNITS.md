# Rehaul units

One unit = one PR. Status: `[ ]` open · `[~]` in progress · `[x] #PR` merged.
Read [README.md](README.md) first: its conventions and decisions apply to every unit.

Sizes: **S** small, one area · **M** a few hundred lines or one new IPC command ·
**L** backend + UI + design decisions.

## Order at a glance

```
Wave 0 (one at a time, in order):  W0-1 → W0-2a → W0-2b → W0-3
Wave 1 (parallel, max ~3):         B · C1 · C2 · E · G · F1 · H
Wave 2 (after their deps):         D1 · D2 · O · A · C3 · F2 · J1 · J2 · I1 · I2 · S
```

| ID | Branch | Size | Depends on | Status |
| --- | --- | --- | --- | --- |
| W0-1 | `chore/rehaul-copy-pass` | S | none | [x] #21 |
| W0-2a | `feat/ui-core-primitives` | M | W0-1 | [x] #23 |
| W0-2b | `feat/ui-filterbar-duration` | M | W0-2a | [x] #25 |
| W0-3 | `feat/experience-tiers` | M | W0-2a | [x] #27 |
| B | `feat/settings-layout` | M/L | W0-3 | [x] #29 |
| C1 | `feat/wizard-provider-version` | L | W0-2b, W0-3 | [x] #31 |
| C2 | `feat/browser-filterbars` | M | W0-2b | [x] #33 |
| E | `feat/content-tabs-rework` | M | W0-2b | [x] #35 |
| G | `feat/java-guide-feedback-polish` | S | W0-2a | [ ] |
| F1 | `feat/hosting-guide-split-path` | L | W0-3 | [ ] |
| H | `feat/dashboard-bento-v2` | L | W0-2a | [ ] |
| D1 | `feat/server-settings-tidy` | S/M | B | [ ] |
| D2 | `feat/motd-server-list` | M | B, D1 | [ ] |
| O | `feat/beginner-overview` | S | B | [ ] |
| A | `feat/onboarding-rework` | M | C1 | [ ] |
| C3 | `feat/wizard-slide-cleanup` | M | C1, W0-2b | [ ] |
| F2 | `feat/hosting-guide-router-test` | M | F1 | [ ] |
| J1 | `feat/beginner-activity-feed` | M | O | [ ] |
| J2 | `feat/beginner-player-actions` | L | J1 | [ ] |
| I1 | `feat/auto-ram` | L | C3, D1 | [ ] |
| I2 | `feat/auto-ram-learning` | L | I1 | [ ] |
| S | `feat/auto-storage-limit` | M | C3, E | [ ] |

---

## Wave 0: foundations

### W0-1 · Copy pass (S)
- Remove em dashes from **user-visible** text only: ~50 TS lines (JSX, toasts,
  labels, help topics) and ~13 Rust strings that reach the UI (toast errors, `system`
  console lines). Grep `—`, skip comments. Keep en-dash number ranges.
  - `DEFAULT_SLEEP_MOTD` exists twice and must stay identical:
    `src/lib/mserve-consts.ts` and `DEFAULT_SLEEP_MOTD` in
    `src-tauri/src/app/support/mserve_config.rs`. Update the tests that assert it
    (`servers-disk-sync.test.tsx`, `mc_protocol.rs` tests, etc.).
- Help slides as bullets: in `src/components/help/help-topics.tsx` add
  `bullets?: string[]` to `HelpSlide`, render them in `help-slideshow.tsx`, and
  convert list-like `body` text to 2–4 short bullets. Keep `body` for one-liners.
- Replace the magic icons (`Wand2`, `Sparkles`) everywhere: onboarding,
  help-topics (3×), MOTD editor "Source" toggle and `decorationIcon`, Settings
  "Replay welcome tour".
- Add the "no em dashes in UI copy" and "help slides use bullets" rules to the
  Critical conventions in root `CLAUDE.md`.

### W0-2a · Core UI primitives (M)
- **`SegmentedControl`** (`src/components/ui/segmented-control.tsx`): a single
  track background, the selected pill slides between options (`motion` `layoutId`,
  respect reduced motion), built on Radix `ToggleGroup` (from the `radix-ui`
  umbrella package, no new dependency) for keyboard/a11y. Options may carry an icon.
  Migrate: `Feedback.tsx` mode toggle, `Network.tsx` (~line 315), `SlideJarFile`
  source mode, `jar-browser.tsx` tabs, `server-statistics-tab.tsx` RAM unit + range,
  MOTD editor Editor/Source. Not the MOTD bold/italic/alignment buttons (those are
  actions/independent toggles).
- **Remove the `outline` button variant** from `src/components/ui/button.tsx` and
  move all 34 uses to `secondary` (tsc lists them). MOTD color swatches need their
  own plain styled button. Check `components/ui/dialog.tsx`.
- **`EmptyState`** (`src/components/empty-state.tsx`): medium icon on a soft rounded
  tile, bold foreground title (`text-xl font-bold`), one muted line, optional
  primary + secondary action. Variants: `empty` and `no-results` (with a
  "Clear search" action). Replace the 4 `CircleX` empty states: `server-backups-tab`,
  `server-item-list`, `modrinth-browser`, `modrinth-project-detail`.

### W0-2b · FilterBar + DurationPicker (M)
- **`FilterBar`**: one integrated row: search input (flex-1), then filter chips
  that open dropdowns (`DropdownMenuCheckboxItem` / radio items from the existing
  dropdown-menu, no new dependency), then a sort dropdown. A chip shows its active
  count (`Provider · 2`) and has a reset. Component + tests only; consumers migrate
  in C2 and E.
- **`DurationPicker`**: value in minutes. Preset chips (default set:
  15m, 30m, 1h, 3h, 6h, 12h, 24h; overridable) + "Custom". Custom input by prop
  `custom: 'wheel' | 'number-unit'`, default `'wheel'`:
  - wheel: two CSS scroll-snap columns (hours 0–48, minutes in 5-minute steps),
    arrow keys and mouse wheel step one item, accessible labels.
  - number-unit: number input + minutes/hours select.
  Min/max props. Component + tests; consumers migrate in C3, E, and the sleep idle
  minutes field (D1).

### W0-3 · Experience tiers (M)
- `src/data/user.tsx`: replace `advanced_mode: boolean` with
  `experience_level: 'beginner' | 'standard' | 'advanced'` (default `'standard'`,
  no migration). Add `useExperience()` returning `{ level, isBeginner, isAdvanced,
  atLeast(level) }`.
- Reclassify all ~56 `advanced_mode` reads (18 files) by the tier table in
  README.md. Rule of thumb: what was advanced-only stays `isAdvanced`; the RAM
  slider and RAM-bytes readout become `atLeast('standard')`; beginner reductions
  listed under "Server settings" apply in `server-settings-panel.tsx` now.
  Beginner reductions for the overview, wizard, and console are later units, so
  leave those screens as they are for every tier.
- Settings > Behavior: the advanced toggle becomes a 3-option `SegmentedControl`.
- Onboarding slide "How hands-on do you want to be?": three cards (Beginner,
  Standard, Advanced) with one-line descriptions. Only the picker; the rest of
  onboarding is unit A.

---

## Wave 1

### B · Settings layout, Discord-style spacing (M/L)
- Extract the sidebar/search/section pattern from `server-settings-panel.tsx` into a
  shared `SettingsLayout` (sections with `title`, `keywords`, `group`, `render`).
- Global `/settings` (`src/pages/Settings.tsx`) moves to it. Groups: **App**
  (Appearance, Behavior & experience level, Updates), **Servers** (Java defaults,
  Tunnel / playit, Server page display (placeholder group for unit O)),
  **Data** (Data & storage). Search works across all.
- Remove the border/Card around each category (one page shows at a time).
- Spacing like Discord's settings (structure only, not colors/fonts/buttons):
  sidebar with small uppercase group headings; content column ~720px max with page
  title on top; sections separated by dividers; rows = label + description on the
  left, control on the right; generous vertical rhythm. Apply to both settings pages.
- Keep the server settings lock overlay, hash deep-links (`#java`, etc.) and
  config-file sections working.

### C1 · Wizard: provider slide + version/Java slide (L)
- Split `SlideJarFile` into **Provider** and **Version** slides
  (`create-server-flow.ts` indices, step counts, proxy flow).
- **Provider slide.** Beginner: goal cards ("Just Minecraft" → Vanilla, "Plugins &
  minigames" → Paper, "Mods" → Fabric, "A modpack" → Modrinth modpacks,
  "A network proxy" → Velocity), each with a one-line plain description. Standard/
  Advanced: provider grid (Paper, Purpur, Folia, Vanilla, Fabric, Velocity,
  BungeeCord, plus "Modpack") with short descriptions. HelpButton (`providers`) on
  both. Generic lucide icon per provider in a tinted rounded tile, same size; add a
  `icon` to the descriptors in `src/lib/server-provider.ts` (verify each icon exists
  in lucide-react 0.563). Respect project memory: forge/neoforge not selectable,
  Spigot/Waterfall import-only.
- **Version slide.** Version list filtered to the chosen provider (modpack: the
  Modrinth browser), **Latest** tag on the newest stable row, Java column. A Java
  section below the list: beginner = automatic with an inline "Download Java N"
  (existing `downloadJavaRuntime`) when no compatible runtime is installed;
  standard = Auto or a detected runtime (`JavaRuntimeSelect`); advanced adds the
  manual jar/path fields that exist today. Persist the pick into the form's
  `java_installation`.
- **Preset input** for unit A: read `location.state` `{ provider?: ProviderName,
  source?: 'software' | 'modpack' }` and preselect.
- Leave the filter layout of the version table to C2 (keep current filters working).

### C2 · FilterBar in the jar picker and Modrinth browser (M)
- `jar-version-selector-pane.tsx`: remove the left filter panel; `FilterBar` on top
  (search, Stability, Java compatibility, plus Provider when a tab has several);
  table takes full width. Keep the "load unstable versions" behavior.
- `modrinth-browser.tsx` (wizard modpacks + server Modrinth dialog): same row
  (search, Compatibility pins, Game version, Categories, Sort); results full width;
  pagination stays.
- Keep `jar-browser.test.tsx` and `modrinth-service.test.ts` green; add tests for
  filter state where cheap.

### E · Content tabs (plugins, mods, worlds, datapacks, backups) (M)
- `server-item-list.tsx`: remove the "Browse Modrinth" link CTA. Show two
  full-width-row cards side by side: the existing "Drop files / Click here" upload
  card and a matching **"Find on Modrinth"** card that opens the Modrinth dialog
  (plugins, mods, datapacks only; worlds keep just the upload card).
- Installed list gets a `FilterBar`: search, Status (Active/Inactive), Source
  (Modrinth / added manually, from the `.mserve-content.json` provenance sidecar,
  see project memory), Sort (name, size, recently added).
- Backups tab header: drop the `…` menu; put **Settings**, **Clear all**
  (destructive-secondary, keep its confirm dialog), **Create named backup**, and
  **Create backup** in one row.
- Backup settings dialog: interval uses `DurationPicker`.
- Empty states: use `EmptyState` with context actions (backups: "Back up now" +
  "Turn on automatic backups"; plugins: "Find on Modrinth").

### G · Java guide + Feedback polish (S)
- Java guide detected runtimes (`src/pages/java-guide/Slide2.tsx`): solid filled
  cards (no border). Keep version + source badge visible; move the path behind a
  small copy-path icon button whose tooltip shows the full path (click copies,
  `use-copy-to-clipboard`).
- Feedback (`src/pages/Feedback.tsx`): remove card outlines, mode toggle is
  `SegmentedControl` (if W0-2a did not already), add a line that opening a GitHub
  issue needs a GitHub account and points to Discord as the no-account option.

### F1 · Hosting guide: split path + fixes (L)
Rewrite `/setup` (`src/pages/Setup.tsx`, `src/pages/setup/*`, plus
`help-topics.tsx` topics `port-forwarding`, `connecting`, `tunneling`).

New flow:
1. Intro (existing first-time / repeat slides).
2. **Choose how friends join**: two cards, Tunnel vs Port forwarding, each with a
   pros/cons list (below). One line up top: players on the same Wi-Fi/home network
   need neither (use the local IP).
3. **Tunnel branch:** claim playit account (`use-playit-account`), pick a server,
   enable its tunnel (reuse `tunnel-settings-section` / `settings-tunnel-card`
   logic), show the address to share. Done.
4. **Port forwarding branch:**
   a. **Before you start:** you need admin access to the router (login page or the
      ISP's app). No access (apartment, dorm, school, shared Wi-Fi) → recommend the
      tunnel, with a button that switches branches.
   b. **Router forward** (detailed guide in F2; in F1 keep the current steps but
      corrected, see facts).
   c. **PC firewall** (the current Slide1, moved after the router step).
   d. **Server IP** slide, then **start a server** slide (existing).

Pros/cons content (bullets):
- Tunnel (playit.gg). Pros: no router access needed; works on networks that block
  forwarding (CGNAT, dorms, apartments); hides your home IP; address stays the same
  if your home IP changes; quick setup. Cons: traffic takes a detour, so a bit more
  ping depending on the nearest playit location; depends on playit being up and on
  your playit account; free tier gives a generated address (custom domains are
  paid); players may show up with the tunnel's address instead of their own, which
  affects IP bans (verify against playit's docs before stating it).
- Port forwarding. Pros: direct connection, lowest ping; no third party or
  account; free with no limits. Cons: needs router admin access and steps differ per
  router; impossible behind CGNAT; shares your home IP (rough location, DDoS
  target); home IPs can change, breaking the address (a dynamic DNS name fixes this);
  opens a port on your network (only the server listens on it).

Facts to fix in the current copy:
- Remove "sometimes port forwarding works out of the box". Correct statement:
  forwarding is unnecessary only for same-network players, with a tunnel, or when
  the router opens ports automatically (UPnP), which the Minecraft server doesn't do.
- Explain CGNAT (common on 5G/mobile home internet, Starlink, some fiber): the ISP
  shares one public IP, so forwarding cannot work; use the tunnel.
- Java Edition needs **TCP** on the port (25565), **inbound** only. Remove the
  "select UDP/TCP and Inbound/Outbound, select both" advice. (Firewall rules may
  keep creating UDP too; harmless, don't advertise it.)
- Show this PC's **local IP** (`useLocalIp`) as the forward target, and advise a
  DHCP reservation / static local IP so it doesn't change.
- IP slide: keep sharing the IPv4 address (`api.ipify.org` is IPv4-only). Move the
  security note out of the Q&A into a visible callout shown with the IP: an IP gives
  a rough location (city/ISP level), not an exact address; the real risk is someone
  flooding the connection (DDoS); share it with people you trust; the tunnel hides
  it. Replace "pinpoint your location".
- Remove the guessed `192.168.0.1` / `10.0.0.1` links only if F2's gateway detection
  is in; otherwise leave them for F2.

### H · Dashboard bento v2 (L)
- No section headers anywhere. Each section (Servers, Storage, Activity, Attention,
  Networks) becomes a **cluster** of cards with no surface of its own: the first
  card is a title card (big bold title + one number, e.g. "Servers" / "4"), then
  one card per item (one per server; storage donut + backups + worlds; wide activity
  chart + peak players + uptime; one card per attention item, tinted by severity;
  one per network). Space between clusters replaces headers.
- Sorting/hiding stays at the cluster level (keep `dashboard_card_order` ids and
  the edit mode).
- **Fix:** the window opens at 1200px, so the viewport `xl:` 4-column grid only
  appears when maximized. Switch the bento to container queries (Tailwind 4
  `@container` + `@xl:` style variants) sized on the content width, and make sure
  the default window looks right.
- Keep `DarkVeil`/background toggle behavior and `dashboard-bento.test.tsx` green.
- Retire `dashboard-section.tsx` if nothing uses it afterwards.

---

## Wave 2

### D1 · Server settings tidy (S/M)
- Move `ServerJarUpdateSection` and **Swap Server Jar** from the Java section to
  General (`edit-server-settings-form.tsx`); update `JAVA_SECTION` keywords and the
  overview's update link (`/servers/:id/settings#java` → General).
- Sleep mode idle minutes uses `DurationPicker`.
- Security (`src/lib/server-security-audit.ts`): every rule emits a `pass` finding
  when satisfied (rate-limit, secure profile, proxy connections, spawn protection,
  compression, broadcast-rcon, max-players), so a fixed item moves to passing
  instead of disappearing. Add tests.
- Replace the anti-bot plugin list with an informational section, e.g.
  **"Protect your server with plugins"**: three groups with icons (Anti-cheat,
  Anti-bot, Other security such as permissions / login protection / backups), each
  2–3 bullets on what it does, plus a button to the Plugins tab. No specific
  plugins. Delete `security-antibot-catalog.ts` and `use-antibot-catalog.ts` if
  unused afterwards.

### D2 · Server list section: MOTD + icon (M)
- New **Server list** section under General for every tier: MOTD + server icon,
  available before the first start (create `server.properties` if missing when
  saving; check what `apply_server_properties` does with a missing file).
  Proxies: velocity.toml MOTD stays in its editor; skip the icon if unsupported.
- MOTD editor look: lines closer together (less padding), a tiled dirt-style
  background drawn as **original art** (not Mojang's texture; e.g. a small generated
  pixel-noise tile in `data:` URL), the server icon on the left like the in-game
  list. Remove the format chip ("Legacy section codes") and the "Line lengths" chip;
  show a remaining-count at the right end of a line only when it is within ~5
  characters of the limit (the editor already measures line width).
- Icon: drag-and-drop or click, accept PNG/JPG/WebP/GIF/BMP/ICO incl. large files,
  cover-crop + scale to 64×64 on a canvas, `toBlob('image/png')`. New commands (add-
  tauri-command skill) `set_server_icon { directory, pngBytes }` (validate PNG
  signature + IHDR 64×64, write `server-icon.png`) and `get_server_icon` (returns a
  `data:image/png;base64,…` or null). CSP already allows `data:`/`blob:` images.
  Check decoding on Linux (WebKitGTK) for ICO; drop ICO from the accept list if
  it fails there.
- Default MOTD = server name: when a server is created (`init_server`), write
  `motd=<name>` if no MOTD exists yet, using the existing properties escaping.

### O · Beginner overview (S)
- Beginner: hide the live metric cards and the Details block on the overview by
  default; keep status, lifecycle buttons, connect/tunnel address.
- Settings > Servers > Server page display: toggles **Show live stats** and
  **Show server details** (user prefs; unset = tier default: off for beginner, on
  otherwise).

### A · Onboarding rework (M)
- Move **Skip tour** under the **Get started** button.
- New second-to-last slide (before the goal slide): the `?` icons around mserve
  open quick help; show one live `HelpButton` example. Keep it short.
- Goal slide: rename survival to **"Survival Multiplayer"** (Vanilla, latest
  stable). Remove the bottom recommendation text and make each goal act:
  survival → wizard preset Vanilla; modded → wizard Fabric (or modpack source);
  plugins → wizard Paper; network → `/network`; explore → dashboard. Use C1's
  `location.state` preset.

### C3 · Wizard slide cleanup (M)
- Auto restart slide: one toggle card ("Restart after a crash", one line of
  description, HelpButton). No repeated sentence or checkbox label.
- EULA becomes a required checkbox on Review (with the EULA link); remove the EULA
  slide and its flow index.
- Backups slide: preset chips via `DurationPicker`, an "also back up when it stops"
  toggle, readable copy.
- Name/directory slide: tidy copy only.

### F2 · Hosting guide: router guide + friend test (M)
- **Router address:** detect the default gateway in Rust (Windows: parse
  `route print -4 0.0.0.0` via `core::no_window_command()`; Linux:
  `/proc/net/route`), no new crate. Show "Your router is probably at X [Open]";
  fall back to the two common addresses.
- **Visual guide** with two tabs, **Website panel** and **App** (Xfinity, Google
  Home/Nest, Eero, Orbi, TP-Link Deco style): illustrated mock forms built in JSX
  (not vendor screenshots) showing the fields: service name "Minecraft", external +
  internal port, protocol TCP, device / local IP (prefilled with this PC's IP).
  Keep the ISP help links and the "don't manage the network" accordion (corrected).
- **Test with a friend** slide (no automated check):
  - Steps: server shows Online in mserve; friend is on a **different network**
    (not your Wi-Fi; phone hotspot is fine); they add the public address in
    Multiplayer and wait ~30 seconds, then refresh.
  - What they see → what it means:
    - Server appears with MOTD/ping bars → it works.
    - "Can't connect to server" / Connection timed out → the request isn't reaching
      the PC: router forward missing or pointing at the wrong local IP, firewall,
      CGNAT, or the ISP blocks the port. Re-check the router step, or use the tunnel.
    - Connection refused → it reached a device but nothing is listening on that
      port: server offline or still starting, wrong port, forward points to another
      device.
    - Unknown host → typo, or a new custom domain hasn't propagated yet.
    - "Not whitelisted", "Failed to verify username", "Outdated client/server" →
      the network works; it's a server setting or version mismatch.
  - Common false results: friend on your Wi-Fi (tests the local path, not the
    internet); testing your own public IP from this PC (routers often don't loop
    back, so it can fail or pass misleadingly); checked too early (server still
    starting, router not yet applied, some need a restart); stale server list
    (refresh); your public IP changed since; a VPN on either side; wrong port
    typed.
  - Buttons: "It worked" (records completion like today) / "It didn't work" (shows
    the table above with a "Switch to tunnel" option).

### J1 · Beginner activity feed (M)
- Beginner only: replace the raw console on the overview with an **Activity** feed;
  a "Show raw console" toggle reveals the real terminal.
- `src/lib/console-events.ts`: pure pattern library turning `server-output` lines
  into events, with unit tests: joined/left, chat, server ready ("Done (…)!"),
  stopping, "Can't keep up!" → "Server is running slow", port already in use
  (FAILED TO BIND), EULA not accepted, plugin failed to load, not whitelisted (with
  an **Add to whitelist** action), out of memory. Unknown lines are not shown in the
  feed.
- Also surface low TPS and high RAM from telemetry as feed events (debounced).
- Lifecycle state stays authoritative from `server-runtime-state` (don't derive
  status from the console).

### J2 · Beginner player list + quick actions (L)
- Backend `get_online_players { directory }` over the existing RCON client: run
  `list`, parse "There are N of a max of M players online: a, b" (vanilla/Paper
  variants), with tests. Proxies unsupported.
- Panel: online players, each with a menu: Op / De-op, Kick, Ban, Add to whitelist,
  Strike with lightning (`execute at <p> run summon lightning_bolt`), Heal
  (`effect give <p> instant_health 1 10`), Game mode. World row: Day / Night, Clear
  weather, Save world (`save-all`), Broadcast (`say`), Keep inventory toggle.
- Validate player names (`^[A-Za-z0-9_]{1,16}$`) and sanitize broadcast text
  (no newlines) before building any command. Hide actions the server can't run
  (Minecraft < 1.13 syntax, proxies). Send through `send_server_command`.

### I1 · Auto RAM: smart cap + elastic heap (L)
- `mserve.json`: add `ram_mode: 'auto' | 'manual'` (snake_case on both sides like
  the other mserve.json structs; update Rust config + normalize, TS schema, mapper,
  sync, repair dialog). Default `auto` for new servers.
- Estimate (frontend + mirrored or computed in Rust, one canonical home): base by
  kind (proxy 512 MB–1 GB; vanilla/plugin 3 GB; modded 4 GB + ~0.5 GB per 25 mods;
  modpack 6 GB) + plugins/max-players adjustments, capped by the system cap.
- System cap: total RAM − reserve (max(3 GB, 20%)) − the `-Xmx` of other servers
  currently running under mserve. Never below the provider minimum; warn if the
  estimate exceeds the cap.
- Start args in `runtime.rs` for auto: `-Xms` low (e.g. min(1 GB, cap/4)), `-Xmx`
  = cap estimate; on Java ≥ 12 add `-XX:+UseG1GC -XX:G1PeriodicGCInterval=60000`
  so idle memory returns to the OS; manual mode keeps `-Xms = -Xmx`. Both platforms.
- UI: an **Auto (recommended)** card at the top of `RamSelector` presets, showing
  the current cap; update the `ram` help topic.

### I2 · Auto RAM: learn from GC logs (L)
- Auto mode adds `-Xlog:gc:file=logs/mserve-gc.log:time,uptime:filecount=2,filesize=2M`
  (Java 9+). The supervisor parses post-GC heap lines (`…M->…M(…M)`) and tracks the
  low envelope of retained heap; `java.lang.OutOfMemoryError` on stderr counts as a
  hard signal.
- Persist a learned value in `mserve.json`. Next start: raise the cap when retained
  heap stays above ~80% of it (or after an OOM); lower it when it stays under ~30%.
  Always within the system cap. Emit a `system` `server-output` line explaining any
  change. Tests for the parser and the decision rule.

### S · Auto storage limit (M)
- Backend `get_disk_space { path }` via `sysinfo` Disks: pick the disk whose mount
  point is the longest prefix of the canonicalized path (case-insensitive on
  Windows), return `{ totalBytes, availableBytes, mountPoint }`. Both platforms.
- Recommendation (frontend helper with tests), for the drive of the server folder
  (backups live in `<server>/.backups`):
  - `reserved` = sum over other servers on the same drive of
    max(0, their storage_limit − their current backups size)
  - `safety` = max(10% of drive total, 20 GB)
  - `budget` = available − reserved − safety
  - default = clamp(roundTo5(budget × 0.3), 5, 200) GB; if budget < 5 GB, use 5 and
    show a low-disk warning.
- UI: in `auto-backup-fields.tsx` and the backup settings dialog, replace the
  number input with a slider (max = available − safety) showing "Recommended X GB ·
  Y GB free on <drive>". Wizard prefills the recommendation.
