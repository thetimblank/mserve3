# OLD DOCS, YOU MAY IGNORE

## Release flow (OTA updates)

This project now uses the Tauri updater plugin.

Yes, mostly correct—but for actual release you don’t need to run local build first.
Recommended:
Bump version in the 3 files.
Commit + push to main.
Create/push tag: git tag v3.1.1 then git push origin v3.1.1.
Workflow runs automatically and publishes assets + latest.json.

## 1) Version bump rule

Always bump app version before building a release:

- `package.json` -> `version`
- `src-tauri/Cargo.toml` -> `version`
- `src-tauri/tauri.conf.json` -> `version`

Use the same semantic version across all three files.

## 2) Build release artifacts

```bash
npm install
npm run release:build
```

Because `bundle.createUpdaterArtifacts` is enabled, Tauri creates updater-compatible artifacts and `.sig` files.

## 3) Publish artifacts + metadata

The updater is configured to use this endpoint:

- `https://github.com/thetimblank/mserve3/releases/latest/download/latest.json`

That means `latest.json` must be uploaded as a **release asset** on GitHub Releases.

For each release (Windows), publish at minimum:

- `MSERVE_<version>_x64-setup.exe`
- `MSERVE_<version>_x64-setup.exe.sig`
- `latest.json`

Optional but recommended to also upload MSI:

- `MSERVE_<version>_x64_en-US.msi`
- `MSERVE_<version>_x64_en-US.msi.sig`

Files are generated here after build:

- `src-tauri/target/release/bundle/nsis/`
- `src-tauri/target/release/bundle/msi/`

### `latest.json` format

Tauri updater static JSON requires:

- `version` (SemVer)
- `platforms.<os-arch>.url`
- `platforms.<os-arch>.signature`

Minimal Windows example:

```json
{
	"version": "3.1.0",
	"notes": "Bug fixes and improvements",
	"pub_date": "2026-02-19T20:20:00Z",
	"platforms": {
		"windows-x86_64": {
			"url": "https://github.com/thetimblank/mserve3/releases/download/v3.1.0/MSERVE_3.1.0_x64-setup.exe",
			"signature": "<contents of MSERVE_3.1.0_x64-setup.exe.sig>"
		}
	}
}
```

`signature` must be the **raw text content** of the `.sig` file, not a path.

### Where to publish

Publish to your repository Releases page:

- <https://github.com/thetimblank/mserve3/releases>

Create a release tag like `v3.1.0`, then upload all files above as assets.

With your updater endpoint, users will always read `latest.json` from the latest release asset URL.

`latest.json` must include valid platform entries and signatures.

## Setup

### 1) One-time setup

1. Generate updater keys:

```bash
npm run release:signer:generate
```

1. Put the public key content into:

- `src-tauri/tauri.conf.json` -> `plugins.updater.pubkey`

1. Store your private key securely (password manager / secrets vault).

### 2) CI/CD secrets

Set these environment variables in your build pipeline (On windows set it in PS using $env:KEY="example"):

- `TAURI_SIGNING_PRIVATE_KEY` (required)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional)

> `.env` files are not used for updater signing during build.

## Deprecated

### 3) App-side behavior

In Settings:

- **Check for updates** calls updater `check()`
- **Install update** calls `downloadAndInstall()`

After install, restart the app to finish update on non-Windows platforms.
On Windows, installer may close the app automatically during installation.

## GitHub Action automation

Workflow file: `.github/workflows/release-tauri.yml`

What it does on tag push (`v*`):

1. Builds signed Tauri bundles
2. Creates `latest.json` from the generated NSIS installer + `.sig`
3. Uploads installer assets and `latest.json` to the GitHub release

Required repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional)

To publish a new OTA update:

1. Bump versions
2. Commit and push
3. Create and push tag (example: `git tag v3.1.1 && git push origin v3.1.1`)

GitHub Actions handles the rest.
