use super::super::*;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Emitter;

/// Max number of recent stderr lines retained per server for crash diagnostics
/// (surfaced on the `crashed` state event).
const STDERR_TAIL_LIMIT: usize = 25;

/// Streams a child's stdout/stderr to the frontend as `server-output` events.
/// stderr lines are additionally retained as a rolling tail on the runtime so a
/// crash can report why it died.
pub(in crate::app) fn emit_output_reader<R: std::io::Read + Send + 'static>(
    reader: R,
    directory: String,
    key: String,
    stream: &'static str,
    app: tauri::AppHandle,
    processes: Arc<Mutex<HashMap<String, ServerRuntime>>>,
) {
    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines().map_while(Result::ok) {
            if stream == "stderr"
                && let Ok(mut guard) = processes.lock()
                    && let Some(runtime) = guard.get_mut(&key) {
                        runtime.stderr_tail.push_back(line.clone());
                        while runtime.stderr_tail.len() > STDERR_TAIL_LIMIT {
                            runtime.stderr_tail.pop_front();
                        }
                    }

            let _ = app.emit(
                "server-output",
                ServerOutputEvent {
                    directory: directory.clone(),
                    stream: stream.to_string(),
                    line,
                },
            );
        }
    });
}

/// Gracefully terminates a runtime's child process: send `stop`, wait briefly,
/// then escalate to a kill. Used by `delete_server`, where we need the process
/// gone synchronously before touching the files.
pub(in crate::app) fn terminate_runtime(runtime: &mut ServerRuntime) -> Result<(), String> {
    if let Some(stdin) = runtime.stdin.as_mut() {
        let _ = writeln!(stdin, "stop");
        let _ = stdin.flush();
    }

    let Some(child) = runtime.child.as_mut() else {
        return Ok(());
    };

    for _ in 0..25 {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(err) => return Err(err.to_string()),
        }
    }

    child.kill().map_err(|err| err.to_string())?;
    child.wait().map_err(|err| err.to_string())?;
    Ok(())
}
