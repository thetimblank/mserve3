# src/CLAUDE.md — React/TypeScript frontend

Frontend-specific guidance. See the root [CLAUDE.md](../CLAUDE.md) for the IPC
contract, event list, and release rule.

## Directory roles

| Path | Role |
| --- | --- |
| `main.tsx` | App root: providers + React Router routes |
| `pages/` | One file per route (`Home`, `Server`, `Settings`, `Network`, `Setup`, `JavaGuide`, `CreateServer`) |
| `pages/server/` | Server-detail building blocks: `hooks/`, `stats/`, panels, tabs, utils |
| `pages/create-server/` | Multi-slide creation wizard + its own Context |
| `pages/network/` | React Flow canvas + multi-server orchestration |
| `components/` | Shared feature components (cards, forms, editors, the runtime monitor) |
| `components/ui/` | shadcn/Radix primitives (button, dialog, select, chart…) — generated style, edit sparingly |
| `data/` | **Global state**: React Context providers (see below) |
| `lib/` | Services, schemas, mappers, pure helpers (no JSX) |
| `hooks/` | Cross-cutting hooks (e.g. `use-mobile`) |

## Talking to the backend

Two primitives from `@tauri-apps/api`:

```ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Call a command. Args are camelCase; the call resolves or throws a string.
await invoke('start_server', { directory, javaExecutable });

// Subscribe to a backend event; returns an unlisten() — call it on cleanup.
const unlisten = await listen('server-runtime-state', (e) => { /* e.payload */ });
```

The four backend → frontend events and where they're consumed:

| Event | Payload (camelCase) | Primary consumer |
| --- | --- | --- |
| `server-runtime-state` | `{ directory, state, pid, startedAt, exitCode, stderrTail }` | `components/server-runtime-monitor.tsx` |
| `server-telemetry` | `{ directory, sample }` | `server-runtime-monitor.tsx`, stats hooks |
| `server-output` | `{ directory, stream, line }` | `pages/server/hooks/use-server-terminal.ts` |
| `java-download-progress` | `{ … progress }` | `data/java-download.tsx` |

`state` is the authoritative lifecycle string (`offline|starting|online|stopping|crashed|running-external`).

**Claimed-server pattern:** `server-runtime-monitor.tsx` is an app-wide listener
that keeps the home/network views in sync. When the server-detail page mounts it
"claims" that server (see `lib/server-runtime-registry.ts`) so the two don't fight
over optimistic updates. If you add a new place that drives a server, respect the
registry.

## State (Context, not Redux/Zustand)

Five providers in `data/`, each backed by `localStorage` (and sometimes disk):

| Provider | File | Storage key |
| --- | --- | --- |
| `ServersProvider` | `data/servers.tsx` | `mserve.servers.v4` |
| `NetworksProvider` | `data/networks.tsx` | `mserve.networks.v1` (disk `networks.json` is source of truth) |
| `UserProvider` | `data/user.tsx` | `mserve.user.v1` |
| `JavaRuntimesProvider` | `data/java-runtimes.tsx` | none (rescanned on startup) |
| `JavaDownloadProvider` | `data/java-download.tsx` | none (transient dialog state) |
| Theme | `components/theme-provider.tsx` | `vite-ui-theme` (default `dark`) |

> Bumping a persisted schema = bump the key version suffix (`.v4`, `.v1`) so old
> blobs don't deserialize into the new shape.

Heavy per-page logic lives in hooks, not components — notably
`pages/server/hooks/use-server-runtime.ts` (lifecycle, optimistic updates, Java
fallback retry, auto-backups) and `use-server-terminal.ts` (per-server console
history). Prefer extending these over inlining logic in JSX.

## Routing (React Router 7)

```
/                          Home (dashboard)
/setup                     initial setup
/java-guide                Java compatibility guide
/network                   network canvas
/servers/new               creation wizard
/servers/:serverId/:tab?   server detail (tab optional)
/settings                  app settings
```

Server-detail tabs (`overview`, `statistics`, `plugins`, `worlds`, `datapacks`,
`backups`, `settings`) are **gated by provider capability** — a Velocity proxy
hides world/plugin tabs. The gate lives in `lib/server-provider-capabilities.ts`;
tab routing in `pages/server/`.

## Conventions

- **Filenames:** pages `PascalCase.tsx`; everything else `kebab-case.tsx/.ts`.
  Suffix by role: `-types`, `-constants`, `-schema`, `-service`, `-utils`,
  `use-*` for hooks.
- **Function prefixes:** `handle*` (event handlers), `is*` (predicates/guards),
  `map*` (shape converters), `build*` (string/command builders), `resolve*`
  (lookups), `parse*` (input parsing).
- **Styling:** Tailwind utilities + `class-variance-authority` for variants;
  compose classes with `cn()` from `lib/utils.ts`. Don't hand-roll CSS files.
- **Toasts:** user-facing errors go through `sonner` (`toast.error(...)`), not
  `alert`/`console`.
- **Path alias:** `@/` → `src/` (configured in `tsconfig.json` + `vite.config.ts`).
- TS is **strict** with `noUnusedLocals`/`noUnusedParameters` — `npm run build`
  fails on unused symbols, so clean them up.
