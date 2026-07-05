---
name: pr
description: Run the full mserve change pipeline — open an issue if the change is non-trivial, branch, implement, test, commit, push, and open a PR referencing the issue — stopping automatically once the PR is open (never merges, never closes the issue, never pushes to main). Use when the user says "open a PR for", "ship this as a PR", "do the full workflow for", or describes a change they want implemented end-to-end.
---

# Ship a change as a PR

Runs issue → branch → implement → test → commit → push → PR, without pausing
for confirmation between those steps — that's the point of this skill. The
one hard stop, non-negotiable, is: **never merge the PR, never close the
issue, never push to `main`.** Those are always the user's call.

If invoked with no description of what to change, ask first — everything
below assumes the goal is already known.

## 1. Preflight

- `git status` — if the tree is dirty with unrelated changes, stop and ask
  (don't silently stash or discard someone's WIP).
- `gh auth status` — if not authenticated, tell the user to run
  `gh auth login` and stop.
- Confirm the starting branch is `main`.

## 2. Decide: trivial or not?

Trivial = typo/docs/obviously non-controversial, matching
[CONTRIBUTING.md](../../../CONTRIBUTING.md#issues)'s issue-skip bar.

- **Non-trivial, no issue number given** → draft and open the issue now,
  using the same drafting logic as the **issue** skill (Bug/Root cause/Fix or
  Problem/Proposal, best-effort labels). Capture the returned issue number.
- **Non-trivial, issue number given** → skip creation, use that number.
- **Trivial** → skip straight to branching; no issue, no `Closes #N`.

## 3. Branch

Base is always `main` — the `v4` branch named in CONTRIBUTING.md doesn't
currently exist in this repo. If a `v4` branch exists at run time, ask the
user which base applies instead of assuming.

```bash
git checkout main && git pull
git checkout -b <type>/<short-kebab-name>   # feat/ fix/ chore/
```

If a branch with that name already exists locally or on the remote, pick a
distinguishing suffix, or check it out and continue if it's clearly the same
in-progress work — never force-overwrite it.

## 4. Implement

Make the change. Carry the spirit of [docs/ai prompts/](../../../docs/ai%20prompts/):
push back if you see a better approach before committing to the plan, keep it
to one concern, and split out a follow-up issue/PR rather than folding in an
unrelated fix you noticed along the way.

## 5. Pre-commit checks (mirror CI, in this order)

```bash
npm run build
npm run test:run
cd src-tauri && cargo fmt && cargo clippy --all-targets && cargo test && cd ..
```

For a runtime/behavior change, delegate to the **verify** skill (and
**run-debug** for runtime/telemetry/terminal changes) instead of reinventing
manual QA steps. If anything fails, fix and re-run before moving on — never
commit red.

## 6. Self-review

Run the **code-review** skill on the diff before committing. Apply clear-win
findings (or `--fix`); use judgment on anything borderline rather than
blocking the pipeline on a low-confidence nit.

## 7. Commit

Conventional commits, `type(scope): description`, subject under 72 chars.
Name files explicitly — never `git add -A`. Split into multiple commits only
if the diff already naturally has more than one concern; one commit is fine
for one concern.

```bash
git add <files>
git commit -m "$(cat <<'EOF'
type(scope): description
EOF
)"
```

## 8. Push + open PR

```bash
git push -u origin <branch>
gh pr create --title "<type>(<scope>): <description>" --body "$(cat <<'EOF'
## What
<bullet summary of the change>

## Why
<1-2 sentences, or the issue's Problem/Root cause>

## How to test
<manual steps, or "covered by npm run test:run / cargo test">

Closes #<N>
EOF
)"
```

Omit the `Closes #N` line entirely for trivial changes with no linked issue.

## 9. Stop here

Report the PR URL (and issue URL, if any) and stop. Tell the user explicitly
that this skill does not merge the PR, does not close the issue, and does
not touch `main` — that's their manual step once CI is green and (per team
rule) it has an approval.

## Edge cases

- **Dirty tree at start** → stop and ask (step 1), don't stash silently.
- **Branch name collision** → don't overwrite; disambiguate or resume.
- **CI red after push** → out of scope for this invocation — report it. If
  the user asks to fix a red run, that's a new ask: pull the failure via
  `gh run view`, fix, commit, push again to the same branch — don't loop
  automatically without being asked.
- **No `gh` auth** → stop at preflight, tell the user to authenticate.
- **No description given** → ask what to work on before anything else.

## Checklist

- [ ] Issue opened first for non-trivial work (or explicit issue # used, or
      change was genuinely trivial)
- [ ] Branched from `main`, name matches `feat|fix|chore/<name>`
- [ ] `npm run build`, `npm run test:run`, `cargo fmt`, `cargo clippy`,
      `cargo test` all green
- [ ] code-review pass applied
- [ ] Commit(s) are conventional-commit style, one concern
- [ ] PR references `Closes #N` when an issue exists
- [ ] Stopped at PR-open — no merge, no issue close, no push to `main`
