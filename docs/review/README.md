# Full-codebase review: agent handoff

This folder tracks a multi-session deep review of mserve. If you're an agent told
to "continue the review", this file is your whole briefing. Read it, then follow
**Session protocol** below.

| File | Purpose |
| --- | --- |
| `README.md` | This file: goals, protocol, rubric, finding format |
| [CHECKLIST.md](CHECKLIST.md) | Every review unit, with its files, focus questions, and status |
| [FINDINGS.md](FINDINGS.md) | The findings log (one row per finding) |

**Baseline:** `main` at `23bd045` (2026-10-27). If `main` has moved, review the
current code, but check `git log 23bd045..main -- <unit files>` first so you know
what changed since the plan was written.

## Goal

Find three kinds of problems, plus doc drift:

| Category | Tag | What counts |
| --- | --- | --- |
| Bugs | `bug` | Incorrect behavior, races, data loss, security holes, platform breakage |
| Unnecessary code | `dead` | Unused exports/commands/deps, dead branches, leftover scaffolding |
| Repetition | `dup` | The same logic in 2+ places that should have one canonical home |
| Doc drift | `doc` | CLAUDE.md, skills, README, or comments that contradict the code |

**This is a review, not a refactor.** Don't edit source files during review
sessions. Fixes happen later, one PR per finding cluster, through the `pr` skill.

## Session protocol

1. Read [/CLAUDE.md](../../CLAUDE.md), [/src/CLAUDE.md](../../src/CLAUDE.md), and
   [/src-tauri/CLAUDE.md](../../src-tauri/CLAUDE.md). They can be out of date (see
   seed findings R-003 to R-005), so trust the code over the docs.
2. Open [CHECKLIST.md](CHECKLIST.md) and take the **first `[ ]` unit** whose
   prerequisites are done (section F runs last). Mark it `[~] (in progress, <date>)`.
   Do 1–3 units per session. Depth is worth more than coverage.
3. **Read every file in the unit fully.** Don't skim, and don't stop at excerpts.
   For each IPC command or event the unit touches, open the other side (Rust ↔ TS)
   and check the contract.
4. Before you log a duplicate, grep for the pattern across the repo so the finding
   names *every* copy, not just two.
5. Verify each suspected bug: trace a concrete input to the wrong output, or
   reproduce it (tests, `cargo test`, a small scratch script). Anything you
   couldn't verify gets `verdict: PLAUSIBLE`.
6. Add the rows to [FINDINGS.md](FINDINGS.md) using the next free `R-###` IDs.
7. Mark the unit `[x] <date>, <n> findings (R-0xx–R-0yy)`. If you found nothing,
   write `0 findings` and one line on what you checked, so the next agent doesn't
   redo it.
8. Commit only `docs/review/` with the message `docs(review): unit <ID>`. Don't
   push unless the user asks.

If a unit is too big for one session, split it in CHECKLIST.md (`A4a`, `A4b`)
and finish the part you claimed.

## Rubric

### Bugs: check these in every unit where they apply

**Rust backend**
- `RuntimeState.processes` mutex held across I/O, sleep, or an `emit` that could
  block (the rule is snapshot, mutate, emit, release).
- `generation` token not checked before a supervisor writes state, so a stale
  thread clobbers a fresh start.
- Path handling: a missing `dunce::canonicalize`, no check that a resolved path
  stays under its root, zip-slip in any archive extraction (modpacks, Java
  downloads, backup restore).
- A `cfg(windows)` branch without a matching `cfg(unix)` / `cfg(target_os = "linux")`
  branch, or the reverse. **The Linux branches only compile in Ubuntu CI, not on the
  Windows dev machine**, so review them by reading and don't assume `cargo check`
  covered them.
- Processes spawned without `core::no_window_command()`.
- Shell/argument injection in `netsh`, `pkexec`, firewalld, or ufw calls.
- `.unwrap()` / `.expect()` on fallible runtime paths. Errors swallowed with `.ok()`
  on a *critical* path (the guidance allows that only for telemetry and best-effort
  cleanup).
- Non-idempotent writes to `server.properties` / `mserve.json`, or writes that
  ignore the read-compare-write rule.
- Network calls with no timeout, and downloads with no size/hash check.

**TypeScript frontend**
- An event `listen()` whose `unlisten` is never called, or is called before the
  promise resolves (the async-unlisten race).
- Stale closures in `useEffect` / `useCallback`: missing deps, or a ref the code
  should be using.
- Optimistic UI updates that race the authoritative `server-runtime-state` event,
  or that ignore the claimed-server registry (`lib/server-runtime-registry.ts`).
- A localStorage shape change without a key version bump (`mserve.servers.v4`, …).
- TS types that don't match the Rust serde shape (camelCase, optional vs required,
  enum strings).
- Errors surfaced through `console` / `alert` instead of `sonner` toasts, or not
  surfaced at all.
- Assuming bare `java` exists. Explicit Java paths are a hard rule.

### Unnecessary code
- Exports, components, or hooks that nothing imports (`npx knip` helps; it's
  configured in `knip.json`; it only sees the JS/TS tree, so `src-tauri/` is out of scope).
- Tauri commands registered in `generate_handler!` (`src-tauri/src/app/mod.rs`)
  that no frontend `invoke` calls. Check the reverse too.
- Unused npm/cargo dependencies, unused feature flags, unused shadcn primitives.
- Branches that can't be reached given the types, plus vestigial compat shims and
  commented-out code.

### Repetition
- Name a **canonical home** for the logic and list every copy as `file:line`.
- Look for these patterns in particular: provider-specific copy-paste, Java version
  mapping duplicated between TS and Rust, HTTP download helpers, slideshow/wizard
  shells, config-file parsers, start/stop/restart orchestration, and path helpers.
- Don't flag shadcn-generated similarity in `components/ui/` as duplication.

### Not findings (skip these)
- Pure style or formatting preferences (`cargo fmt` and the TS conventions cover them).
- Work flagged as intentionally incomplete. The dashboard bento overhaul is
  "1/2" as of `23bd045`, and a missing second half isn't dead code.
- Intentional decisions recorded in project memory: Spigot/Waterfall are
  import-only, forge/neoforge can't be selected in the wizard, playit is pinned to
  git tag `v1.0.10`, and Sentry is frontend-only and opt-in.

## Finding format

Each finding is one row in the FINDINGS.md table:

| Column | Values |
| --- | --- |
| ID | `R-001`, `R-002`, … assigned in order |
| Unit | The checklist unit ID, e.g. `A2` |
| Cat | `bug` / `dead` / `dup` / `doc` |
| Sev | `high` (data loss, security, crash, wrong lifecycle state) · `med` (user-visible misbehavior, notable maintenance cost) · `low` (cleanup) |
| Location | `path:line`, separating several with `;` |
| Summary | One sentence |
| Evidence | A concrete failure scenario for bugs; the list of copies for dups; "0 importers (grep/knip)" for dead code |
| Fix | A short suggested direction, not code |
| Verdict | `CONFIRMED` / `PLAUSIBLE` |
| Status | `open` / `false-positive` / `fixed #<PR>` |

If a finding needs more than a table cell can hold, add a `### R-0xx` subsection
under **Details** in FINDINGS.md.

## Tools you can use

- `npm run build` (tsc strict: catches unused locals) and `npm run test:run`
- `npx knip` (unused files/exports/deps on the frontend)
- In `src-tauri/`: `cargo check`, `cargo clippy --all-targets`, `cargo test`
- Grep or ripgrep for cross-references
- Use the `run-debug` skill if a runtime bug needs reproducing in the real app

Don't run the gated E2E matrix (`cargo test --test e2e -- --ignored`) unless the
user asks. It's slow and downloads real server jars.

## When the review is finished

When every unit in A–E is `[x]`, run section F. F3 groups the `dup` findings into
consolidation proposals and F2/F4 sweep for whatever slipped between units. Then
give the user a summary sorted by severity and suggest PR groupings. Each group
becomes one `pr` skill run.
