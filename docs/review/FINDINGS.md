# Review findings

The format and severity scale are defined in [README.md](README.md#finding-format).
Add rows at the bottom and don't reuse IDs. R-001 to R-010 are seeds from the
planning pass. The unit that owns each seed must verify it and update its verdict.

| ID | Unit | Cat | Sev | Location | Summary | Evidence | Fix | Verdict | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-001 | A1 | dead | low | src-tauri/src/app/commands/runtime.rs:778; src-tauri/src/app/mod.rs:963 | `get_running_server_directories` is registered but no frontend code invokes it | Grep of `src/` for the command name: 0 hits. Only the definition and its `generate_handler!` entry exist | Remove the command, or document who calls it | PLAUSIBLE | open |
| R-002 | A1 | dead | low | src-tauri/src/app/commands/setup.rs:149; src-tauri/src/app/mod.rs:926 | `inspect_server_directory` is registered but no frontend code invokes it | Grep of `src/`: 0 hits. Check whether import/repair flows replaced it | Remove it, or fold any logic still in use into the live command | PLAUSIBLE | open |
| R-003 | F4 | doc | med | CLAUDE.md:26 | Root CLAUDE.md says "There is no test suite and no linter config" and then documents Vitest, cargo test, and the E2E matrix | The same file, lines 26 and 36–41 | Delete the stale sentence | CONFIRMED | open |
| R-004 | F4 | doc | med | CLAUDE.md:77; src/CLAUDE.md:36 | The event table lists 4 events, but the backend emits 8 | Not listed: `modpack-install-progress`, `server-jar-download-progress`, `playit-claim-state`, `playit-tunnel-state` (each an `EVENT` const in `src-tauri/src`) | Update both tables | CONFIRMED | open |
| R-005 | F4 | doc | low | src-tauri/CLAUDE.md:23-61,124 | The module map leaves out `modrinth.rs`, `modpack.rs`, `content_meta.rs`, `mc_protocol.rs`, `sleep_listener.rs`, `testkit.rs`. It also says "no CI lint gate", but `ci.yml` runs `cargo fmt --check` (blocking) and clippy (non-blocking) | `.github/workflows/ci.yml:61,66-68` | Refresh the module map and the lint sentence | CONFIRMED | open |
| R-006 | C4 | dup | med | src/lib/server-actions.ts; src/lib/server-controls.ts | Both modules build optimistic start/stop transitions with `offlineServerStats` / `startingServerStats` | Both import from `lib/server-telemetry`. `server-actions.ts` has one importer (`dashboard/needs-attention.tsx`), and `server-controls.ts` has four | Merge into one module after `e0097ba` (lifecycle gating) lands | PLAUSIBLE | open |
| R-007 | D3 | dup | med | src/components/edit-server-properties-form.tsx; src/components/server-config-file-editor/server-properties-editor.tsx | There may be two separate editors for `server.properties` (a 1010-line form and the config-file editor) | Not yet verified that the field sets and parsers overlap | If they overlap, keep one parser/serializer and share it | PLAUSIBLE | open |
| R-008 | D3 | dup | low | src/components/ram-selector.tsx; src/components/ram-slider-field.tsx; src/components/server-setup-form-fields.tsx | `ram-selector` wraps `ram-slider-field`, but `server-setup-form-fields` uses the slider directly, so the wrapper may be redundant | Importers: ram-selector ← edit-server-properties-form, SlideRam; ram-slider-field ← ram-selector, server-setup-form-fields | Collapse to one component if the wrapper adds nothing | PLAUSIBLE | open |
| R-009 | E9 | dup | low | src/pages/setup/*; src/pages/java-guide/*; src/components/help/help-slideshow.tsx; src/pages/create-server/slides/SlideShell.tsx | Four slideshow/wizard systems, each with its own context and navigation | Not yet compared | Pull out one shared slideshow primitive if their behavior matches | PLAUSIBLE | open |
| R-010 | E1 | dup | med | src/pages/server/hooks/use-server-runtime.ts:502,718; src/components/server-runtime-monitor.tsx:98,303 | The page hook and the app-wide monitor both listen to `server-output` and `server-telemetry` and map them to stats | The claimed-server registry is meant to stop them fighting. Check whether the mapping/Java-error detection is duplicated, not just the listening | Share one mapper, and keep ownership with the registry | PLAUSIBLE | open |

## Details

<!-- Add a "### R-0xx" subsection here for any finding that needs more room. -->
