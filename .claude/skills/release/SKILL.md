---
name: release
description: Cut an mserve release — bump the version in all three required files to one semver and build signed installers. Use when the user says "cut a release", "bump the version", "ship a new version", or "build a release".
---

# Release mserve

mserve ships as a signed Tauri desktop app with OTA updates. The updater reads
`latest.json`, whose version comes from `tauri.conf.json` — so the **single most
important rule** is that the version is identical across three files.

## 1. Decide the version

Format (from README):
- Stable: `vMAJOR.MINOR.PATCH` (e.g. `v3.5.0`)
- Pre-release: `vMAJOR.MINOR.PATCHpreN` (e.g. `v3.5.0pre3`)

Ask the user which, or infer from the latest git tag (`git tag --sort=-v:refname`
/ `git log --oneline -5`).

## 2. Bump the version in ALL THREE files (same value)

- [package.json](../../../package.json) → `"version"`
- [src-tauri/Cargo.toml](../../../src-tauri/Cargo.toml) → `version` under `[package]`
- [src-tauri/tauri.conf.json](../../../src-tauri/tauri.conf.json) → `"version"`

> Cargo/semver may not accept the `preN` suffix the same way the app's display does —
> match the existing style already in these files rather than assuming. If they
> currently disagree with the latest tag, point that out before bumping.

After editing, **verify all three match**:

```bash
grep -H '"version"' package.json src-tauri/tauri.conf.json
grep '^version' src-tauri/Cargo.toml
```

## 3. Build

```bash
npm install
npm run release:build
```

Signing needs `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
in the environment (locally provided via the project's signing setup; in CI via
GitHub secrets). Output: NSIS `.exe` + MSI `.msi`, each with a `.sig`.

## 4. Publish (CI does the heavy lifting)

`.github/workflows/release-tauri.yml` triggers on a pushed `v*` tag, builds on
`windows-latest`, and uploads the installers + `latest.json` to the GitHub Release.
So the normal flow is:

```bash
git commit -am "vX.Y.Z ..."      # only if the user asked to commit
git tag vX.Y.Z
git push && git push --tags
```

**Do not commit, tag, or push unless the user explicitly asks.** Confirm the tag
name matches the version you bumped.

## Checklist
- [ ] Same semver in package.json, Cargo.toml, tauri.conf.json
- [ ] `npm run release:build` succeeds locally (or rely on CI)
- [ ] Tag `vX.Y.Z` matches the bumped version
