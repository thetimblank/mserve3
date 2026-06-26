// Pedantic clippy lints that fight this crate's conventions are silenced at the
// crate root so `cargo clippy -- -W clippy::pedantic` stays clean. Each is either
// a Tauri framework requirement or an intentional, reviewed trade-off.
#![allow(
    // Tauri command handlers receive owned args (`String`, payload structs) plus
    // `State`/`AppHandle` by value — that's the macro-generated calling convention.
    clippy::needless_pass_by_value,
    // Every `#[tauri::command]` returns `Result<T, String>` per the IPC contract,
    // even when the current body can't fail.
    clippy::unnecessary_wraps,
    // Telemetry/metrics math casts between integer and float widths intentionally;
    // the inputs are bounded well within range.
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    // A handful of command/supervisor functions are linear setup routines that read
    // better as one block than split for the line count alone.
    clippy::too_many_lines,
    // Fixed-size I/O copy buffers live on the worker-thread stack by design.
    clippy::large_stack_arrays,
    // Inspection-result DTOs are flat serde payloads, not state machines.
    clippy::struct_excessive_bools,
    // `run()` panics only if the Tauri runtime fails to start, which is fatal anyway.
    clippy::missing_panics_doc
)]

mod app;

pub use app::run;
