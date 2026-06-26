# Contributing to mserve

Thanks for your interest. This doc covers everything you need to contribute a bug fix, feature, or refactor — whether you're a new external contributor or picking up a task on an existing team.

## Table of contents

- [Getting started](#getting-started)
- [Branching model](#branching-model)
- [Issues](#issues)
- [Pull requests](#pull-requests)
- [Commit style](#commit-style)
- [Code standards](#code-standards)
- [Testing](#testing)
- [What not to do](#what-not-to-do)

---

## Getting started

Prerequisites: **Node 20**, **Rust stable**, **VS Code** (recommended).

```bash
git clone https://github.com/thetimblank/mserve3.git
cd mserve3
npm install
npm run dev          # Vite + Tauri window with HMR
```

For backend-only checks, run `cargo check` / `cargo clippy` / `cargo fmt` inside `src-tauri/`.

See [CLAUDE.md](CLAUDE.md) for the full command reference and repo map.

---

## Branching model

| Branch | Purpose |
| --- | --- |
| `main` | Always releasable. CI must be green. Direct pushes only for maintainers doing trivial one-liners. |
| `v4` | Long-running branch for the v4 rewrite (breaking changes, Linux support, etc.). Periodically merges from `main` to pick up v3 patches. |
| `feat/<name>` | New features — branch from `main` (or `v4` if v4-only). |
| `fix/<name>` | Bug fixes. |
| `chore/<name>` | Dependency bumps, CI changes, tooling, non-functional cleanup. |

**Keep branches short-lived.** A branch that lives for more than a week is a sign the scope is too big — break it up.

For v4 work, branch from `v4`, not `main`.

---

## Issues

Open an issue before starting non-trivial work. This avoids duplicate effort and gets alignment on approach before code is written.

- **Bug:** describe what happened, what you expected, and steps to reproduce. Include mserve version and Windows version.
- **Feature / enhancement:** describe the problem you're solving, not just the solution. Link to any relevant v4 roadmap items.
- **Use labels:** `bug`, `enhancement`, `chore`, `v4`, `good first issue`.
- **Milestones:** assign to a version milestone (`v3.6`, `v4.0`) if you know where it lands.

You don't need an issue for: typo fixes, docs tweaks, or changes that are obviously non-controversial. Use judgment.

---

## Pull requests

1. **One concern per PR.** A PR that fixes a bug AND adds a feature is harder to review and harder to revert. Split them.
2. **Branch from the right base.** v3 work → `main`. v4 work → `v4`.
3. **CI must pass** before requesting review. Don't open a PR with a known red build.
4. **Reference the issue** in the PR description (`Closes #123` or `Fixes #123`).
5. **Write a clear description.** Include: what changed, why, and how to test it manually if the automated tests don't cover it.
6. **Small is better.** A 200-line PR gets reviewed in minutes; a 2000-line PR gets skimmed. If your change is large, ask in the issue whether to split it first.

**Team rule (when there are multiple contributors):** PRs to `main` or `v4` require one approval before merging. Maintainers can self-merge only for trivial chores.

---

## Commit style

Use the conventional commit format: `type(scope): short description`

| Type | When |
| --- | --- |
| `feat` | New user-visible feature |
| `fix` | Bug fix |
| `chore` | Tooling, deps, CI, non-functional |
| `refactor` | Code change with no behavior change |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |

Examples:
```
feat(providers): add Folia support
fix(dashboard): correct port display in connect widget
chore(deps): bump rusqlite to 0.32
```

Keep the subject line under 72 characters. If the change needs more explanation, add a blank line and a body paragraph — don't cram it into the subject.

---

## Code standards

### Frontend (TypeScript / React)

- TypeScript strict mode is on — no `any`, no `@ts-ignore` without a comment explaining why.
- Component state lives in React Context (`src/data/`); don't reach for a global state library.
- Tauri IPC calls go through the service layer (`src/lib/`), not directly in components.
- Struct fields from Rust arrive as `camelCase` (the backend uses `#[serde(rename_all = "camelCase")]`).
- No new dependencies without discussion. Check if what you need is already available (Radix UI, Tailwind utilities, etc.).

### Backend (Rust)

- Every `#[tauri::command]` returns `Result<T, String>`. Errors are plain strings on the JS side.
- New structs that cross the IPC boundary need `#[derive(serde::Serialize, serde::Deserialize)]` and `#[serde(rename_all = "camelCase")]`.
- `cargo fmt` is enforced by CI — run it before pushing.
- Clippy warnings are not yet a hard gate, but don't introduce new ones intentionally. The goal is to get to `-D warnings` soon.
- This app is Windows-only today. Don't add POSIX-only code paths (e.g., `std::os::unix`) without a `#[cfg]` guard and a corresponding Windows path.

### General

- No comments explaining *what* code does — good names do that. Only comment the *why* when it's non-obvious (a workaround, a hidden constraint, a subtle invariant).
- Don't add error handling, fallbacks, or validation for scenarios that can't happen in practice.
- Don't design for hypothetical future requirements. Three similar lines is better than a premature abstraction.

---

## Testing

| Layer | How to run | What it covers |
| --- | --- | --- |
| Frontend unit tests | `npm run test:run` | React components, utilities |
| Rust unit + integration | `cargo test` (inside `src-tauri/`) | Backend logic, fake-server tests |
| Real-server E2E (slow) | `cargo test --test e2e -- --ignored` (inside `src-tauri/`) | Full server lifecycle against real jars |

See [docs/testing.md](docs/testing.md) for the full picture.

**New code should come with tests** where it's practical. Bug fixes should ideally add a test that reproduces the bug. If a feature is purely UI-driven and hard to unit test, say so in the PR description.

---

## What not to do

- **Don't commit directly to `main`** for anything non-trivial. Even solo, a branch + PR gives you a CI gate and a paper trail.
- **Don't skip CI.** If the build is red, fix it before asking for a review.
- **Don't bump versions manually.** Use the `/release` skill (Claude Code) or follow the exact three-file rule in [CLAUDE.md](CLAUDE.md). Partial bumps break the OTA updater.
- **Don't add platform abstractions for Linux/Mac prematurely.** Linux support is a v4 goal; until then, Windows-specific code is fine.
- **Don't add a dependency** just to save a few lines. Evaluate maintenance burden and binary size, especially on the Rust side.
- **Don't open a PR without a linked issue** for features or non-obvious fixes. "I'll explain in the PR" is not a substitute for upfront alignment.
