---
name: add-tauri-command
description: Add a new Tauri IPC command (Rust backend function callable from the React frontend) and wire it end-to-end. Use when the user wants to "add a command", "expose a backend function", "add an IPC call", or call new Rust logic from the UI.
---

# Add a Tauri command

A command is a Rust function the frontend calls via `invoke()`. Wiring it takes
four steps; **step 3 is the one that's silently broken if skipped** (unregistered
commands fail at runtime, not compile time).

## 1. Write the Rust function

Pick the domain-appropriate file in
[src-tauri/src/app/commands/](../../../src-tauri/src/app/commands/) (e.g.
`runtime.rs` for lifecycle, `settings.rs` for config, `items.rs` for content).
Follow the neighbors:

```rust
#[tauri::command]
pub fn my_new_command(directory: String, some_flag: bool) -> Result<MyResult, String> {
    // ... return Ok(..) or Err("human-readable message".into())
}
```

- **Always return `Result<T, String>`** — the `Err` string surfaces to JS as a thrown error.
- Need shared runtime state? Take `state: tauri::State<RuntimeState>` (see existing
  commands in `runtime.rs`). Need the app handle (to emit events)? Take `app: tauri::AppHandle`.
- Payload/result structs that cross the boundary get
  `#[derive(Serialize/Deserialize)]` + `#[serde(rename_all = "camelCase")]`.

## 2. Make sure it's exported

Modules under `commands/` are re-exported so `app/mod.rs` can name the function.
If you added the fn to an existing file, it's already reachable. New file → add it
to the module tree the way the siblings are declared.

## 3. Register it in `generate_handler!` ⚠️

In [src-tauri/src/app/mod.rs](../../../src-tauri/src/app/mod.rs), add the function
name to the `tauri::generate_handler![ … ]` list (~line 546). Without this the
frontend gets a "command not found" error at call time.

## 4. Call it from the frontend

```ts
import { invoke } from '@tauri-apps/api/core';

// snake_case command name; camelCase args matching the Rust params.
const result = await invoke<MyResult>('my_new_command', {
  directory,
  someFlag: true,   // -> some_flag in Rust
});
```

Wrap calls that can fail in try/catch and surface errors via `toast.error(...)`
(`sonner`). Add a matching TS type for the result; if the command belongs to an
existing service, put the wrapper in the relevant `src/lib/*.ts` file rather than
inlining `invoke` in a component.

## Verify
- `cargo check` (in `src-tauri/`) compiles.
- `npm run build` typechecks the frontend.
- Run `npm run dev` and exercise the path (see the **run-debug** skill).
