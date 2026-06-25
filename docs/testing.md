# Testing mserve

mserve uses a **layered test pyramid**: a large, fast base that runs on every change
(CI gate + local pre-push hook) and a small, slow real-server matrix gated to nightly /
pre-release.

| Layer | What | How to run | When |
| --- | --- | --- | --- |
| **L1** | Rust unit tests (parsers, codecs, config, state machine) | `cd src-tauri && cargo test` | every change |
| **L2** | Frontend Vitest (pure logic + heavy hooks, mocked Tauri) | `npm run test:run` | every change |
| **L3** | Fake-Minecraft integration (supervisor → telemetry → store) | `cd src-tauri && cargo test` | every change |
| **L4** | Real-server E2E matrix (real Java + real jars) | `cd src-tauri && cargo test --test e2e -- --ignored` | nightly / pre-release |

## Quick start

```sh
npm install            # also installs the git pre-push hook
npm run test:run       # frontend (L2)
cd src-tauri && cargo test   # backend L1 + L3
```

## Frontend (Vitest)

- Config: [vitest.config.ts](../vitest.config.ts) — jsdom env, `@` alias, global APIs.
- Setup: [src/test/setup.ts](../src/test/setup.ts) mocks `@tauri-apps/api/core`
  (`invoke`) and `@tauri-apps/api/event` (`listen`).
- Test helpers: [src/test/tauri-mock.ts](../src/test/tauri-mock.ts) —
  `mockInvoke(cmd, handler)` to stub an IPC command, `emitTauriEvent(event, payload)`
  to push a backend event to active `listen` subscribers.
- Tests live next to the code: `src/**/*.test.ts(x)`.

```ts
import { mockInvoke, emitTauriEvent } from '@/test/tauri-mock';

mockInvoke('start_server', () => ({ ok: true }));
emitTauriEvent('server-runtime-state', { directory: 'C:/srv', state: 'online' });
```

## Backend (cargo test)

- Unit tests are co-located in `#[cfg(test)] mod tests` next to the code.
- The **fake Minecraft server** (`testkit`) speaks Server-List-Ping + RCON over a
  loopback port so the supervisor/telemetry pipeline can be driven without a JVM.
- Dev-deps: `tempfile` (hermetic temp dirs), `serial_test` (serialize tests that
  touch the process-wide telemetry DB).

## Real-server matrix (L4)

Behind `--ignored` so it never runs in the fast suite. It downloads real Java and real
provider jars (Vanilla / Paper / Velocity / a modded custom jar), boots each with tiny
RAM, asserts `online` + telemetry, then stops. Run it explicitly or via the
`e2e-nightly` workflow.

## CI

- [ci.yml](../.github/workflows/ci.yml) — every PR/push (`windows-latest`): build +
  typecheck, Vitest, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`.
- [e2e-nightly.yml](../.github/workflows/e2e-nightly.yml) — schedule + manual: the L4
  matrix.

## Local pre-push hook

`npm install` runs `scripts/install-git-hooks.mjs`, which points `core.hooksPath` at
[.githooks/](../.githooks/). The `pre-push` hook runs the fast suite and blocks the
push on failure. Bypass with `git push --no-verify`.
