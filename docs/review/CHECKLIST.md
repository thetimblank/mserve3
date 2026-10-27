# Review checklist

The protocol is in [README.md](README.md). Status markers: `[ ]` todo · `[~]` in progress (date) ·
`[x]` done (date, finding count and IDs). Work through A → E in any order, but do F last.
Line counts are as of `23bd045`.

Out of scope: `package-lock.json`, `src-tauri/Cargo.lock`, `src/lib/fonts/*`,
`src-tauri/icons/*`, `public/*`, `.vscode/*`, `.gitignore` files.

---

## A. Backend core & runtime (Rust)

### [x] A1 · App bootstrap & state (~1.1k) — 2026-10-27, 5 findings (R-011–R-015); seeds R-001/R-002 confirmed. Registered↔invoked diff: only R-001/R-002 are unmatched (no invoke targets an unregistered command except the `ping` mock in smoke.test.ts). Observation, not logged: mod.rs holds ~45 DTOs that would read better in their domain modules.
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/app/mod.rs` (991)
- `src-tauri/src/app/commands.rs`
- `src-tauri/src/app/support.rs`

Focus: diff `generate_handler!` against every frontend `invoke` in both directions (seeds R-001, R-002).
Do the struct/enum definitions in `mod.rs` belong in their domain modules? Plugin and state
setup order. Exit/cleanup hooks on both platforms.

### [x] A2 · Supervisor (~940) — 2026-10-27, 4 findings (R-016–R-019). Telemetry cadence (1s starting / 5s online), the 10s stop→kill escalation, and the crash-loop cap all match the docs. Generation is checked in phases 1 and 3; the gaps are in R-016 and R-018.
- `src-tauri/src/app/support/supervisor.rs`

Focus: is the mutex ever held across sleep, I/O, or emit? Is the `generation` token checked
before *every* state write? starting→online probe logic, crash vs. clean exit, the ~10s stop
then force-kill path, running-external adoption, and the telemetry cadence.

### [x] A3 · Process plumbing & IO (~730) — 2026-10-27, 4 findings (R-020–R-023). Every spawn goes through `no_window_command`. Job object vs. pgid + atexit/signal parity is OK apart from R-022. The stderr tail is bounded at 25 lines.
- `src-tauri/src/app/support/process.rs` (443)
- `src-tauri/src/app/support/runtime_io.rs`
- `src-tauri/src/app/support/core.rs`

Focus: job object (Windows) vs. process group + exit hook (Linux) parity. Could port→PID kill
hit an unrelated process? Is every spawn routed through `no_window_command`? Reader-thread
termination, stderr ring-buffer bounds, and non-UTF-8 output handling.

### [x] A4 · Runtime commands (~1.15k) — 2026-10-27, 8 findings (R-024–R-031). The `--nogui` retry lives in the frontend (E1/D2), not here. RCON is provisioned before spawn, and its errors are swallowed on purpose. Observation: the tunnel commands and `delete_server` would sit better outside `runtime.rs`.
- `src-tauri/src/app/commands/runtime.rs`

Focus: start/stop/restart/force-kill races (double-click, restart during stop), the automatic
`--nogui` retry, RCON provisioning order, whether the tunnel commands belong here, and any
logic duplicated with the supervisor.

### [x] A5 · Telemetry (~1.15k) — 2026-10-27, 3 findings (R-032–R-034). Timestamps are epoch ms on both sides (`Date.now()`). The TPS cache lives per runtime, so it resets on restart or provider change. Bucket gap-filling is covered by tests.
- `src-tauri/src/app/support/telemetry.rs` (667)
- `src-tauri/src/app/support/telemetry_store.rs` (417)
- `src-tauri/src/app/commands/telemetry.rs`

Focus: TPS detection cache invalidation (after a provider change or restart), sysinfo
CPU-sampling correctness, the SQLite single-connection mutex under contention, the 30-day
pruning, bucket-averaging edge cases (empty or partial buckets), and the timestamp units
the TS side expects.

### [x] A6 · Wire protocols (~860) — 2026-10-27, 5 findings (R-035–R-039). VarInt reads cap at 5 bytes without overflow panics. `server.properties` writes keep comments and order, and RCON provisioning only writes on change. The sleep listener releases its port synchronously before a wake.
- `src-tauri/src/app/support/rcon.rs`
- `src-tauri/src/app/support/mc_protocol.rs`
- `src-tauri/src/app/support/server_properties.rs`
- `src-tauri/src/app/support/sleep_listener.rs`

Focus: packet length bounds and VarInt overflow, read/write timeouts, multi-packet RCON
responses, that `server.properties` writes are idempotent and keep comments/order, and how the
sleep listener hands its port back to the real server (bind races).

## B. Backend config, setup, content (Rust)

### [x] B1 · mserve.json config (~1.16k) — 2026-10-27, 2 findings (R-044, R-045); B2 owns the setup-side overlap (R-040–R-043). Writes go through the one write lock + temp/rename. Unknown keys are rejected on purpose (strict schema); R-040 covers what that does to the repair fallback. Concurrent whole-file writers vs `patch_mserve_json` are R-070.
- `src-tauri/src/app/support/mserve_config.rs`

Focus: read/normalize/write paths, provider inference heuristics, write-on-change, handling
of unknown or legacy fields, and concurrent writers (settings vs. runtime).

### [x] B2 · Setup / import / repair (~640) — 2026-10-27, 4 findings (R-040–R-043). `inspect_server_directory` is gone (R-002, #8). EULA is written only on explicit consent. Import never touches existing files beyond mserve.json.
- `src-tauri/src/app/commands/setup.rs`

Focus: overlap with `mserve_config.rs`, what import does to an existing directory, the repair
flow, EULA handling, and whether `inspect_server_directory` is dead (R-002).

### [x] B3 · Providers & jar download (~950) — 2026-10-27, 5 findings (R-046–R-050). Per-provider code is distinct enough (different APIs) that only the Fabric pieces count as copy-paste. HTTP calls all have timeouts. Progress events match the TS type.
- `src-tauri/src/app/commands/providers.rs`

Focus: per-provider copy-paste (Paper/Purpur/Velocity/Vanilla/Fabric/BungeeCord/…), checksum
verification, partial-download cleanup, progress event emission, HTTP timeouts, and error-string
quality. Cross-check against `src/lib/server-provider.ts` / `jar-download-service.ts` (C5).

### [x] B4 · Modrinth & modpacks (~1.65k) — 2026-10-27, 4 findings (R-051–R-053, R-075). `.mrpack` entries and overrides go through `safe_relative_path` (no zip-slip); sha512 is checked when present. The sidecar survives toggles (same key) and is cleared on delete.
- `src-tauri/src/app/commands/modrinth.rs` (727)
- `src-tauri/src/app/commands/modpack.rs` (818)
- `src-tauri/src/app/support/content_meta.rs`

Focus: shared HTTP/download helpers between these two and providers.rs (B3), zip-slip in `.mrpack`
extraction, `overrides/` path validation, sha verification, and whether the
`.mserve-content.json` sidecar stays consistent after a delete or toggle.

### [x] B5 · Items, scan, config files (~840) — 2026-10-27, 5 findings (R-054–R-058). The config-file allowlist is fixed and case-normalized; `apply_server_properties` has its own key allowlist.
- `src-tauri/src/app/commands/items.rs`
- `src-tauri/src/app/support/items.rs`
- `src-tauri/src/app/support/scan.rs`
- `src-tauri/src/app/commands/config_files.rs`

Focus: traversal guards on every user-supplied name, active/inactive toggle semantics
(and name collisions), export/upload overwrite behavior, and the config-file allowlist.

### [x] B6 · Backups (~1.1k) — 2026-10-27, 5 findings (R-059–R-063). Retention math (age → smart buckets → count → storage) matches its tests. Zip extraction uses `enclosed_name`. `session.lock` is skipped when copying.
- `src-tauri/src/app/support/backups.rs` (968)
- `src-tauri/src/app/commands/backups.rs`

Focus: retention math, a restore while the server is running, partial-copy failure (is the
original destroyed first?), locked files on Windows (session.lock), and symlink following.

### [x] B7 · Java detection & download (~700) — 2026-10-27, 2 findings (R-064, R-065), plus R-046–R-048 shared with B3. Windows/Linux/macOS install scans are at parity; version parsing handles `1.8`, `17` and `21.0.2`. The MC→Java table lives only in TS (C6 to confirm).
- `src-tauri/src/app/commands/java.rs` (503)
- `src-tauri/src/app/commands/java_download.rs`

Focus: Windows registry, PATH, and JAVA_HOME scan vs. the Linux scan; version parsing; zip vs.
tar.gz extraction safety; progress events; and Java-version mapping duplicated with
`src/lib/java-*.ts` (C6).

### [x] B8 · Networking & firewall (~790) — 2026-10-27, 3 findings (R-066–R-068). No injection: netsh/pkexec/firewall-cmd/ufw only ever see a `u16` port and fixed strings, and the network-file allowlist rejects traversal. The Velocity forwarding secret is written as-is (standard Velocity layout).
- `src-tauri/src/app/commands/network.rs`
- `src-tauri/src/app/commands/networks.rs`
- `src-tauri/src/app/support/windows_firewall.rs`
- `src-tauri/src/app/support/linux_firewall.rs`

Focus: argument injection into `netsh` / `pkexec` / `firewall-cmd` / `ufw`, cfg parity,
`networks.json` atomic writes, and Velocity forwarding-secret handling.

### [x] B9 · Playit, settings, navigation (~860) — 2026-10-27, 3 findings (R-069–R-071). Agents stop with the server (supervisor/stop paths) and die with the process. The claim poll is bounded at 5 min. `delete_server` safety was covered in A4. `validate_path` only stats the path.
- `src-tauri/src/app/support/playit.rs` (521)
- `src-tauri/src/app/commands/playit.rs`
- `src-tauri/src/app/commands/settings.rs`
- `src-tauri/src/app/commands/navigation.rs`

Focus: agent thread lifecycle (shutdown on server stop or app exit), claim-state polling,
secret storage, `delete_server` safety (could it delete outside the server root?), and
`validate_path`.

### [x] B10 · Rust tests, manifest, Tauri config (~1.2k) — 2026-10-27, 3 findings (R-072–R-074). Version is 3.5.1 in all three manifests. The updater uses minisign over an HTTPS GitHub endpoint. Capabilities hold no fs/shell scopes.
- `src-tauri/src/app/support/testkit.rs`
- `src-tauri/tests/e2e.rs` (842)
- `src-tauri/Cargo.toml`
- `src-tauri/build.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`

Focus: unused crates and features, capabilities broader than needed (fs/shell scopes), CSP,
updater config, and test helpers duplicated between testkit and e2e.

## C. Frontend state & services

### [ ] C1 · Servers store (~800)
- `src/data/servers.tsx` (694)
- `src/data/server-updates.tsx`
- `src/data/server-lifecycle-actions.test.ts` *(only exists on `fix/centralize-lifecycle-action-gating` until it merges)*

Focus: localStorage schema/versioning, merging disk mserve.json with the cached copy,
action gating, and re-render cost of the context value.

### [ ] C2 · Other stores (~740)
- `src/data/networks.tsx`
- `src/data/user.tsx`
- `src/data/java-runtimes.tsx`
- `src/data/java-download.tsx`

Focus: disk-vs-localStorage source of truth (networks), listener cleanup on the
`java-download-progress` event, and duplicated persistence boilerplate across the providers.

### [ ] C3 · mserve schema, sync, mapper (~390)
- `src/lib/mserve-schema.ts`
- `src/lib/mserve-sync.ts`
- `src/lib/mserve-server-mapper.ts`
- `src/lib/mserve-server-mapper.test.ts`
- `src/lib/mserve-repair-controller.ts`
- `src/lib/mserve-consts.ts`
- `src/lib/server-root-path.ts`

Focus: field-by-field parity with the Rust `mserve_config.rs` struct (B1), defaults that disagree
between TS and Rust, and the repair-controller event pattern.

### [ ] C4 · Server lifecycle libs (~400)
- `src/lib/server-actions.ts`
- `src/lib/server-controls.ts`
- `src/lib/server-runtime-registry.ts`
- `src/lib/server-runtime-registry.test.ts`
- `src/lib/server-telemetry.ts`
- `src/lib/server-telemetry.test.ts`
- `src/lib/telemetry-keys.test.ts`
- `src/lib/server-flags-service.ts`

Focus: the start/stop duplication in seed R-006, registry claim/release correctness, and the
lifecycle-state → UI-status mapping.

### [ ] C5 · Providers & jars, TS side (~920)
- `src/lib/server-provider.ts`
- `src/lib/server-provider-capabilities.ts`
- `src/lib/jar-download-service.ts`
- `src/lib/server-update-service.ts`
- `src/lib/server-update-service.test.ts`

Focus: provider lists and capabilities duplicated with Rust (B3), version sorting, and the
update-check cadence.

### [ ] C6 · Java libs (~820)
- `src/lib/java-compatibility.ts`
- `src/lib/java-compatibility.test.ts`
- `src/lib/java-resolution.ts`
- `src/lib/java-resolution.test.ts`
- `src/lib/java-runtime-service.ts`

Focus: does the MC-version → Java-version table exist in both TS and Rust? Also check the
no-bare-`java` rule and the resolution order.

### [ ] C7 · Network engine (~730)
- `src/lib/network-config-engine.ts`
- `src/lib/network-schema.ts`

Focus: Velocity/Bungee config generation correctness, forwarding modes, and idempotent
re-apply.

### [ ] C8 · Content & config libs (~1.1k)
- `src/lib/modrinth-service.ts`
- `src/lib/modrinth-service.test.ts`
- `src/lib/server-config-files.ts` (380)
- `src/lib/server-security-audit.ts`
- `src/lib/server-security-audit.test.ts`
- `src/lib/security-antibot-catalog.ts`

Focus: do Modrinth API calls happen in both TS and Rust (B4)? Check config-file parsing
duplicated with `components/server-config-file-editor/*` (D4), and the audit rule correctness.

### [ ] C9 · Misc libs (~1.2k)
- `src/lib/motd-format.ts` (651)
- `src/lib/motd-format.test.ts`
- `src/lib/utils.ts`
- `src/lib/utils.test.ts`
- `src/lib/ram-utils.ts`
- `src/lib/ram-utils.test.ts`
- `src/lib/platform.ts`
- `src/lib/sentry.ts`
- `src/lib/animations/features.ts`
- `src/lib/animations/lazy.tsx`

Focus: helpers in `utils.ts` that get re-implemented elsewhere (grep for formatBytes, debounce,
path joins), Sentry opt-in, and PII scrubbing.

## D. Frontend shell & shared components

### [ ] D1 · App shell (~1.3k)
- `src/main.tsx`
- `src/components/app-sidebar.tsx`
- `src/components/nav.tsx`
- `src/components/theme-provider.tsx`
- `src/components/mode-toggle.tsx`
- `src/components/native-context-menu.tsx`
- `src/components/close-warning-dialog.tsx`
- `src/components/logo.tsx`
- `src/components/dark-veil-effect.tsx`
- `src/index.css`
- `src/vite-env.d.ts`
- `index.html`
- `splashscreen.html`

Focus: provider nesting order, close-warning logic vs. running servers, whether the WebGL
effect is disposed on unmount, and unused CSS.

### [ ] D2 · Runtime monitor & server card (~730)
- `src/components/server-runtime-monitor.tsx`
- `src/components/server-status.tsx`
- `src/components/server-card.tsx`

Focus: seed R-010 (overlap with `use-server-runtime.ts`), unlisten races, and claimed-server respect.

### [ ] D3 · Server properties form (~1.7k)
- `src/components/edit-server-properties-form.tsx` (1010)
- `src/components/ram-selector.tsx`
- `src/components/ram-slider-field.tsx`
- `src/components/server-setup-form-fields.tsx`
- `src/components/java-runtime-select.tsx`

Focus: seeds R-007 and R-008, and form-state duplication with the create-server wizard (E7).

### [ ] D4 · Config file editor (~2.2k)
- `src/components/server-config-file-editor.tsx`
- `src/components/server-config-file-editor/advanced-properties-section.tsx`
- `src/components/server-config-file-editor/featured-property-fields.tsx`
- `src/components/server-config-file-editor/file-operations.ts`
- `src/components/server-config-file-editor/json-array-editor.tsx`
- `src/components/server-config-file-editor/json-config.ts`
- `src/components/server-config-file-editor/layout.tsx`
- `src/components/server-config-file-editor/plain-text-editor.tsx`
- `src/components/server-config-file-editor/properties-config.ts`
- `src/components/server-config-file-editor/property-field.tsx`
- `src/components/server-config-file-editor/server-properties-editor.tsx`
- `src/components/server-config-file-editor/text-normalizers.ts`
- `src/components/server-config-file-editor/toml-config.ts`
- `src/components/server-config-file-editor/types.ts`
- `src/components/server-config-file-editor/use-unsaved-changes-toast.tsx`
- `src/components/server-config-file-editor/utils.ts`
- `src/components/server-config-file-editor/velocity-toml-editor.tsx`

Focus: the hand-rolled TOML handling in `toml-config.ts` when `@iarna/toml` is already a dependency,
whether the properties parser is duplicated with D3 / `lib/server-config-files.ts`, and whether
saving preserves comments.

### [ ] D5 · MOTD editor (~1.55k)
- `src/components/motd-editor.tsx`

Focus: parsing/serialization duplicated with `lib/motd-format.ts`, whether the 1.5k-line
component has obvious extraction seams, and legacy § vs. JSON round-tripping.

### [ ] D6 · Content components (~1.6k)
- `src/components/server-item-list.tsx` (586)
- `src/components/server-jar-update-section.tsx`
- `src/components/modrinth/modrinth-browser-dialog.tsx`
- `src/components/modrinth/modrinth-browser.tsx`
- `src/components/modrinth/modrinth-project-detail.tsx`
- `src/components/modrinth/modrinth-project-icon.tsx`

Focus: pagination/search debounce, and stale results arriving out of order.

### [ ] D7 · Import, repair, help, onboarding (~1.4k)
- `src/components/import-server.tsx`
- `src/components/mserve-repair-dialog.tsx`
- `src/components/create-server.tsx`
- `src/components/open-folder-button.tsx`
- `src/components/help/help-button.tsx`
- `src/components/help/help-connection-addresses.tsx`
- `src/components/help/help-slideshow.tsx`
- `src/components/help/help-topics.tsx`
- `src/components/onboarding/onboarding-overlay.tsx`

Focus: import flow vs. the wizard (duplicated validation?), and seed R-009 (help-slideshow).

### [ ] D8 · shadcn primitives (~3.1k, mostly generated)
- `src/components/ui/accordion.tsx`
- `src/components/ui/alert-dialog.tsx`
- `src/components/ui/button-group.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/chart.tsx`
- `src/components/ui/checkbox.tsx`
- `src/components/ui/container.tsx`
- `src/components/ui/context-menu.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/drawer.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/components/ui/field.tsx`
- `src/components/ui/input-group.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/label.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/separator.tsx`
- `src/components/ui/sheet.tsx`
- `src/components/ui/sidebar.tsx`
- `src/components/ui/skeleton.tsx`
- `src/components/ui/slider.tsx`
- `src/components/ui/sonner.tsx`
- `src/components/ui/spinner.tsx`
- `src/components/ui/textarea.tsx`
- `src/components/ui/tooltip.tsx`
- `src/hooks/use-mobile.ts`
- `components.json`

Focus: **only** unused primitives and unused exports, plus local edits that introduced bugs.
Is `sonner.tsx` coupled to `next-themes` while the app uses its own `theme-provider`? Don't
restyle anything.

## E. Frontend pages

### [ ] E1 · Server runtime hooks (~1.7k)
- `src/pages/server/hooks/use-server-runtime.ts` (988)
- `src/pages/server/hooks/use-server-runtime.test.tsx`
- `src/pages/server/hooks/use-server-terminal.ts`
- `src/pages/server/hooks/use-server-terminal.test.ts`
- `src/pages/server/hooks/use-server-ui-state.ts`

Focus: optimistic updates vs. events, the Java-fallback retry loop (can it run more than
intended?), auto-backup triggers, terminal history memory bounds, and R-010.

### [ ] E2 · Other server hooks & security (~800)
- `src/pages/server/hooks/use-server-backup-actions.ts`
- `src/pages/server/hooks/use-server-tunnel.ts`
- `src/hooks/use-playit-account.ts`
- `src/pages/server/security/security-settings-section.tsx`
- `src/pages/server/security/use-antibot-catalog.ts`
- `src/pages/server/security/use-security-audit.ts`

Focus: `use-server-tunnel` vs. `use-playit-account` overlap, and listener cleanup for the playit events.

### [ ] E3 · Server page & panels (~1.8k)
- `src/pages/Server.tsx` (493)
- `src/pages/server/server-overview-panel.tsx` (501)
- `src/pages/server/server-terminal-panel.tsx`
- `src/pages/server/crash-details-panel.tsx`
- `src/pages/server/server-page-skeleton.tsx`
- `src/pages/server/server-content-tabs.tsx`
- `src/pages/server/server-types.ts`
- `src/pages/server/server-utils.ts`
- `src/pages/server/server-constants.ts`

Focus: capability-gated tabs (can a hidden tab still be reached by URL?), `server-types.ts` vs.
Rust payloads, and helpers in `server-utils.ts` duplicated in `lib/`.

### [ ] E4 · Server settings & backups tabs (~1.5k)
- `src/pages/server/server-settings-panel.tsx` (671)
- `src/pages/server/server-settings-tab.tsx`
- `src/pages/server/server-backups-tab.tsx` (668)
- `src/pages/server/tunnel-settings-section.tsx`

Focus: settings saved while the server is running (which take effect when?), backup tab logic
duplicated with `use-server-backup-actions.ts`.

### [ ] E5 · Statistics (~670)
- `src/pages/server/server-statistics-tab.tsx`
- `src/pages/server/stats/metric-card.tsx`
- `src/pages/server/stats/stats-utils.ts`
- `src/pages/server/stats/telemetry-area-chart.tsx`
- `src/pages/server/stats/telemetry-sparkline.tsx`
- `src/pages/server/stats/use-server-telemetry-history.ts`

Focus: timestamp units vs. telemetry_store (A5), polling plus event double-counting, and
chart formatting helpers duplicated with the dashboard.

### [ ] E6 · Dashboard & server list (~2.0k)
- `src/pages/Home.tsx`
- `src/pages/Servers.tsx`
- `src/pages/dashboard/activity-insights.tsx`
- `src/pages/dashboard/bento-card.tsx`
- `src/pages/dashboard/bento-shapes.ts`
- `src/pages/dashboard/dashboard-activity.test.ts`
- `src/pages/dashboard/dashboard-bento.test.tsx`
- `src/pages/dashboard/dashboard-bento.tsx`
- `src/pages/dashboard/dashboard-metrics.tsx`
- `src/pages/dashboard/dashboard-networks.tsx`
- `src/pages/dashboard/dashboard-section.tsx`
- `src/pages/dashboard/dashboard-servers.tsx`
- `src/pages/dashboard/edit-layout-tile.tsx`
- `src/pages/dashboard/needs-attention.tsx`
- `src/pages/dashboard/server-tile.tsx`
- `src/pages/dashboard/stat-card.tsx`
- `src/pages/dashboard/storage-insights.tsx`
- `src/pages/dashboard/use-dashboard-activity.ts`
- `src/pages/dashboard/use-dashboard-storage.ts`

Focus: `server-tile.tsx` vs. `components/server-card.tsx`, `stat-card` vs. `stats/metric-card`, and
the persisted layout schema. **The bento overhaul is 1/2 complete**, so don't flag planned work as dead.

### [ ] E7 · Create-server wizard (~2.6k)
- `src/pages/CreateServer.tsx`
- `src/pages/create-server/CreateServerContext.tsx` (630)
- `src/pages/create-server/create-server-flow.ts`
- `src/pages/create-server/slides/SlideAutoRestart.tsx`
- `src/pages/create-server/slides/SlideBackups.tsx`
- `src/pages/create-server/slides/SlideDirectory.tsx`
- `src/pages/create-server/slides/SlideDone.tsx`
- `src/pages/create-server/slides/SlideEula.tsx`
- `src/pages/create-server/slides/SlideIntro.tsx`
- `src/pages/create-server/slides/SlideJarFile.tsx` (529)
- `src/pages/create-server/slides/SlideRam.tsx`
- `src/pages/create-server/slides/SlideReview.tsx`
- `src/pages/create-server/slides/SlideShell.tsx`
- `src/pages/create-server/slides/components/JarDownloadModal.tsx`
- `src/pages/create-server/slides/components/JarVersionSelectorPane.tsx`

Focus: wizard state vs. the D3 form (duplicate defaults/validation), the cancel path mid-download,
and directory validation vs. Rust `validate_path`.

### [ ] E8 · Network page (~1.9k)
- `src/pages/Network.tsx` (399)
- `src/pages/network/ApplyChangesDrawer.tsx`
- `src/pages/network/NetworkCanvas.tsx`
- `src/pages/network/NetworkInspector.tsx` (502)
- `src/pages/network/ServerNodeMenu.tsx`
- `src/pages/network/nodes.tsx`
- `src/pages/network/use-network-orchestration.ts`
- `src/pages/network/use-network-telemetry.ts`

Focus: orchestration ordering (proxy before or after backends), partial-failure handling, and
whether `use-network-telemetry` duplicates the runtime monitor.

### [ ] E9 · Settings, setup, guides, feedback (~1.9k)
- `src/pages/Settings.tsx`
- `src/pages/settings/hooks/use-app-update.ts`
- `src/pages/settings/settings-appearance-card.tsx`
- `src/pages/settings/settings-behavior-card.tsx`
- `src/pages/settings/settings-data-card.tsx`
- `src/pages/settings/settings-java-card.tsx`
- `src/pages/settings/settings-tunnel-card.tsx`
- `src/pages/settings/settings-update-card.tsx`
- `src/pages/Setup.tsx`
- `src/pages/setup/SetupContext.tsx`
- `src/pages/setup/Slide1.tsx`
- `src/pages/setup/Slide2.tsx`
- `src/pages/setup/Slide3.tsx`
- `src/pages/setup/Slide4.tsx`
- `src/pages/setup/SlideInitialSetup.tsx`
- `src/pages/setup/SlideRepeatSetup.tsx`
- `src/pages/JavaGuide.tsx`
- `src/pages/java-guide/Slide0.tsx`
- `src/pages/java-guide/Slide1.tsx`
- `src/pages/java-guide/Slide2.tsx`
- `src/pages/java-guide/Slide3.tsx`
- `src/pages/java-guide/Slide4.tsx`
- `src/pages/java-guide/SlideContext.tsx`
- `src/pages/Feedback.tsx`

Focus: seed R-009 (the slideshow systems), the updater flow (download, install, relaunch, errors),
the "clear data" scope in `settings-data-card`, and whether Feedback leaks PII into the issue URL.

## F. Cross-cutting sweeps (run after A–E)

### [ ] F1 · IPC contract audit
Go through every `invoke('…')` in `src/` and check it against the Rust signature (arg names in
camelCase, optional vs. required, return shape). Then check every event payload against its TS type.
Use one table per domain, and log only the mismatches.

### [ ] F2 · Dead-code & dependency sweep
Run `npx knip` and `cargo clippy --all-targets -- -W dead_code`, and refresh the registered-vs-invoked
command diff. Check for unused or overlapping npm deps: `@dnd-kit/*`, `ogl`, `vaul`, `next-themes`,
`yaml` + `@iarna/toml`, and `radix-ui` alongside individual `@radix-ui/*` packages. Check unused cargo crates.

### [ ] F3 · Duplication synthesis
Group all the `dup` findings into consolidation proposals. Each proposal names one canonical home,
the copies to delete, and a suggested PR order.

### [ ] F4 · Build, CI, tooling & docs
- `package.json`
- `vite.config.ts`
- `vitest.config.ts`
- `tsconfig.json`
- `tsconfig.node.json`
- `knip.json`
- `.github/workflows/ci.yml`
- `.github/workflows/e2e-nightly.yml`
- `.github/workflows/release-tauri.yml`
- `.githooks/pre-push`
- `scripts/install-git-hooks.mjs`
- `src/test/setup.ts`
- `src/test/smoke.test.ts`
- `src/test/tauri-mock.ts`
- `docs/testing.md`
- `README.md`
- `CONTRIBUTING.md`
- `CLAUDE.md`
- `src/CLAUDE.md`
- `src-tauri/CLAUDE.md`
- `.claude/settings.json`
- `.claude/skills/add-provider/SKILL.md`
- `.claude/skills/add-tauri-command/SKILL.md`
- `.claude/skills/issue/SKILL.md`
- `.claude/skills/pr/SKILL.md`
- `.claude/skills/release/SKILL.md`
- `.claude/skills/run-debug/SKILL.md`
- `docs/ai prompts/add.txt`
- `docs/ai prompts/fix.txt`
- `docs/ai prompts/rework.txt`

Focus: seeds R-003 to R-005, plus anything the A–E units logged as `doc`. Does the release workflow
check that the 3 version files match? Does the pre-push hook match CI? The `smoke.test.ts`
`ping` mock is for a command that doesn't exist (harmless, but confirm it's only a mock-harness test).
