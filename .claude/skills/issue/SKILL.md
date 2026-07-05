---
name: issue
description: File a GitHub issue on mserve3 for a bug, feature, or chore — drafts a concrete title and body (Bug/Root cause/Fix or Problem/Proposal structure) and opens it with gh, without touching any code. Use when the user says "open an issue", "file a bug", "create an issue for", or wants to track work before someone picks it up.
---

# File a GitHub issue

Opens an issue only — no branch, no code, no PR. The riskiest step is picking
the right structure: bugs and features read very differently, and a vague
issue is worse than no issue.

## 1. Decide if an issue is warranted

Per [CONTRIBUTING.md](../../../CONTRIBUTING.md#issues): skip for typo fixes,
docs tweaks, or changes that are "obviously non-controversial." If the user's
ask is clearly this trivial, say so and don't open an issue unless they insist.

## 2. Gather context (don't ask if you can find it)

- **Bug:** trace the code path yourself first — cite exact `file.ts:123`
  locations rather than describing symptoms in prose.
- **Feature/chore:** if the description is thin, ask at most one clarifying
  question, and only if you genuinely can't proceed (e.g. "which page does
  this belong on?"). Otherwise draft from what's given — don't interrogate.

## 3. Draft title + body

- Title: plain description, not conventional-commit style (e.g. "Update
  notification badge doesn't clear after restart", not "fix: badge").
- **Bug body:** `## Bug` (what happens / expected) → `## Root cause` (with
  `path/file.tsx:LINE` links if known) → `## Fix` (proposed approach, if known).
- **Feature/chore body:** `## Problem` (why, not just what) → `## Proposal`
  (concrete approach) → optionally `## Out of scope`.
- Be concrete — real file/line references beat prose.

## 4. Labels (best-effort, not required)

Run `gh label list` first; only pass labels that actually exist in the repo
(commonly `bug`, `enhancement`, `documentation`, `good first issue`).
`chore` and `v4` from CONTRIBUTING.md are **not** real labels here — don't
invent them. If nothing fits, create the issue without labels rather than
blocking on it.

## 5. Create it

```bash
gh issue create --title "<title>" --body "$(cat <<'EOF'
<body>
EOF
)" --label "<label>"   # omit --label entirely if none apply
```

Report the issue number and URL from the command output back to the user.

## Verify

- [ ] Issue opened, URL returned to the user
- [ ] Title is descriptive, not a conventional-commit fragment
- [ ] Body has concrete structure (Bug/Root cause/Fix, or Problem/Proposal)
- [ ] No labels forced onto the issue if none of the existing repo labels fit
- [ ] No branch created, no code touched
