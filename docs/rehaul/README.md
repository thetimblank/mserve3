# UX rehaul: agent handoff

This folder drives a multi-PR overhaul of mserve's UX (beginner-first, plus a new
middle "Standard" tier). If you were told to "do rehaul unit X", this file is your
briefing and [UNITS.md](UNITS.md) holds your unit's spec.

| File | Purpose |
| --- | --- |
| `README.md` | Protocol, conventions, and the decisions already made with the user |
| [UNITS.md](UNITS.md) | Every unit (one unit = one PR): scope, files, dependencies, status |

Potential future features that came out of planning (not in scope here) live in the
root [README.md](../../README.md#potential-future-features).

## Session protocol

1. Read [/CLAUDE.md](../../CLAUDE.md), [/src/CLAUDE.md](../../src/CLAUDE.md), and
   [/src-tauri/CLAUDE.md](../../src-tauri/CLAUDE.md), then this file, then your unit.
2. **Check dependencies.** Every unit listed under your unit's `Depends on` must be
   `[x]` in UNITS.md on `origin/main`. If one isn't, stop and tell the user.
3. Run the **pr** skill for your unit. The issue title/body come from the unit spec.
   - **Worktrees:** if `main` is checked out in another worktree, `git checkout main`
     fails. Branch from the remote instead:
     `git fetch origin && git checkout -b <branch> origin/main`.
   - Use the branch name given in the unit.
4. Stay inside your unit's scope. Anything else you notice goes in the PR
   description under "Noticed, out of scope" (or a new issue), not in the diff.
5. In the same PR, flip your unit's status in UNITS.md to `[x]` and add the PR
   number after it is opened (a follow-up commit on the branch is fine, like
   `docs(rehaul): point <ID> at #N`).
6. If the unit turns out too big for one PR, split it in UNITS.md (`C1a`, `C1b`),
   do the first part, and leave the rest `[ ]` with a note.

## Conventions every unit follows

- **No em dashes (`—`) in user-visible text** (TS strings/JSX and Rust messages
  that reach the UI). En dashes in number ranges (`2–4 GB`) are fine. Code comments
  are out of scope. Rewrite with a period, comma, colon, or parentheses.
- **Help slides use bullets**, not long sentences, when the content is a list of
  facts. Short, scannable fragments.
- **Buttons:** the `outline` variant is gone (unit W0-2a). Use `secondary`.
- **Single-choice button groups** use `SegmentedControl` (W0-2a), never two buttons
  swapping `default`/`secondary`.
- **Empty states** use `EmptyState` (W0-2a). "Nothing here yet" and "search found
  nothing" are different variants.
- **Search + filter rows** use `FilterBar` (W0-2b): one row on top, never a left
  filter panel.
- **Durations** (minutes/hours inputs) use `DurationPicker` (W0-2b).
- **Experience gating** goes through the experience helper from W0-3
  (`useExperience()`), never `user.advanced_mode` (it no longer exists after W0-3).
- **Icons:** generic `lucide-react` icons only (no brand logos), so they match each
  other. The "magic" icons (`Wand2`, `Sparkles`) are banned.
- Both Windows and Linux must keep working (see root CLAUDE.md). New IPC commands
  follow the **add-tauri-command** skill.
- New logic gets tests where practical (Vitest / `cargo test`). Pure UI: say so in
  the PR.

## Decisions already made (don't re-litigate)

### Experience tiers
Three levels replace the `advanced_mode` boolean: **Beginner**, **Standard**,
**Advanced**. No data migration is needed (single user so far); missing values
default to `standard`.

| Area | Beginner | Standard | Advanced |
| --- | --- | --- | --- |
| RAM | Auto + presets | Auto, presets, slider | Everything |
| Provider pick (wizard) | "What do you want to build?" goal cards | Provider grid with short descriptions + help | Provider grid + manual jar/metadata |
| Java in wizard | Automatic, inline "Download Java N" when missing | Auto or pick a detected runtime | Plus a manual java path |
| Overview | Simplified: control panel instead of console, stats/details hidden by default | Full overview + console | Full |
| Server settings | Name, server list (MOTD/icon), auto restart, backups, sleep, tunnel, security, Java (auto/download only), featured server.properties fields | Adds stats tab, provider & telemetry, all featured config files | Adds custom flags, java path override, YAML editors, all raw properties, location, forwarding secrets / host overrides |

Tunneling stays visible to beginners: it is the easiest way for them to host.

### Copy and naming
- Onboarding goal "survival" is titled **"Survival Multiplayer"** and uses
  **Vanilla** on the latest stable version.
- Provider icons are generic lucide icons.

### Wizard
- EULA moves onto the Review slide as a required checkbox (its slide is removed).
- Auto restart stays its own slide, simplified to one toggle card.
- The jar picker's filters move to a top `FilterBar`; versions get a **Latest** tag.

### Memory (RAM) "Auto" mode
Java cannot raise its max heap while running, so Auto means: a smart starting cap,
a low `-Xms` with a capped `-Xmx` so the JVM grows/shrinks inside the cap, periodic
G1 uncommit on Java 12+, a system-wide cap that accounts for other running servers,
then (later unit) learning from GC logs and adjusting on the next start.

### Backup storage limit
Auto-detected from the server folder's drive (backups live in `<server>/.backups`),
combined with what other servers on that drive may still use. Formula in unit S.

### Duration picker
Preset chips first. The custom input is an iOS-style scroll wheel **as an
experiment**; the user will judge it in use. Build `DurationPicker` with a
`custom` prop (`'wheel' | 'number-unit'`) so switching is a one-line change.
`number-unit` ("Every [30] [minutes ▾]") is the standard fallback.

### Server icon
Accept common images (PNG, JPG, WebP, GIF, BMP, ICO; large ones too), cover-crop
and scale to **64×64 PNG** in the frontend (canvas), write `server-icon.png`
through a backend command that validates it.

### Hosting guide
- Split path: **Tunnel vs Port forwarding**, with a pros/cons comparison on the
  choice slide (general, not only security).
- Router forwarding comes **before** the PC firewall step.
- **No automated reachability check.** Verification is "test with a friend", with
  clear interpretation of what the friend sees and the common false results.
  Automated checks are a future feature.
- Share the **IPv4** address. The IP security note is a visible callout, not a
  hidden Q&A item.

### Feedback
GitHub prefill stays for now (it requires the reporter to have a GitHub account;
say so on the page). Sentry User Feedback is a future feature.

## Hotspot files (don't run these units at the same time)

| File | Units |
| --- | --- |
| `src/components/edit-server-settings-form.tsx` | B, D1, D2, I1 |
| `src/pages/server/server-settings-panel.tsx` | W0-3, B, D1 |
| `src/pages/Server.tsx` | E, O, J1, J2 |
| `src/pages/create-server/**` | C1, C3, A, I1, S |
| `src/components/modrinth/modrinth-browser.tsx` | C2 (owner), E |
| `src/components/auto-backup-fields.tsx` | C3, S |
| `src/pages/setup/**` | F1, F2 |
