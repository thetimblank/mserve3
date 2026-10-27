use super::super::{ServerOutputEvent, ServerRuntime};
use super::playit;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::ChildStdin;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Emitter;

/// Max number of recent stderr lines retained per server for crash diagnostics
/// (surfaced on the `crashed` state event).
const STDERR_TAIL_LIMIT: usize = 25;

/// A child's stdin, shareable so writes can happen outside the `processes` lock.
pub(in crate::app) type StdinHandle = Arc<Mutex<ChildStdin>>;

/// Emits a `server-output` "system" line for a server directory (used to explain
/// backend-driven actions like a crash restart or a wake in the console).
pub(in crate::app) fn emit_system_line(
    app: &tauri::AppHandle,
    directory: &str,
    line: impl Into<String>,
) {
    let _ = app.emit(
        "server-output",
        ServerOutputEvent {
            directory: directory.to_string(),
            stream: "system".to_string(),
            line: line.into(),
        },
    );
}

/// Strips the trailing `\n` / `\r\n` that `read_until` leaves on a line.
fn trim_line_ending(bytes: &mut Vec<u8>) {
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
        if bytes.last() == Some(&b'\r') {
            bytes.pop();
        }
    }
}

/// Reads the next line (without its line ending), decoding invalid UTF-8
/// lossily. `None` at EOF or on a read error.
fn next_lossy_line<R: BufRead>(reader: &mut R, bytes: &mut Vec<u8>) -> Option<String> {
    bytes.clear();
    match reader.read_until(b'\n', bytes) {
        Ok(0) | Err(_) => None,
        Ok(_) => {
            trim_line_ending(bytes);
            Some(String::from_utf8_lossy(bytes).into_owned())
        }
    }
}

/// Streams a child's stdout/stderr to the frontend as `server-output` events.
/// stderr lines are additionally retained as a rolling tail on the runtime so a
/// crash can report why it died.
///
/// Lines are decoded lossily: a JVM writing in a non-UTF-8 code page (Cp1252 on
/// Windows) must not end the stream, or the pipe stops being drained and every
/// later line is lost.
pub(in crate::app) fn emit_output_reader<R: std::io::Read + Send + 'static>(
    reader: R,
    directory: String,
    key: String,
    stream: &'static str,
    app: tauri::AppHandle,
    processes: Arc<Mutex<HashMap<String, ServerRuntime>>>,
) {
    thread::spawn(move || {
        let mut buffered = BufReader::new(reader);
        let mut bytes = Vec::new();
        while let Some(line) = next_lossy_line(&mut buffered, &mut bytes) {
            if stream == "stderr"
                && let Ok(mut guard) = processes.lock()
                && let Some(runtime) = guard.get_mut(&key)
            {
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

/// Writes one console line to a child's stdin. Call this *without* holding the
/// `processes` lock: a child that stops reading stdin can block the write.
pub(in crate::app) fn write_stdin_line(stdin: &StdinHandle, line: &str) -> Result<(), String> {
    let mut stdin = stdin
        .lock()
        .map_err(|_| "Server console lock failed.".to_string())?;
    writeln!(stdin, "{line}").map_err(|err| err.to_string())?;
    stdin.flush().map_err(|err| err.to_string())
}

/// A graceful-stop write captured under the `processes` lock and sent after it
/// is released.
pub(in crate::app) struct StopRequest {
    stdin: StdinHandle,
    command: &'static str,
}

impl StopRequest {
    pub(in crate::app) fn send(&self) {
        let _ = write_stdin_line(&self.stdin, self.command);
    }
}

/// The graceful-stop write for an owned server (its provider's shutdown
/// command), or `None` when we hold no stdin handle (adopted/external server).
pub(in crate::app) fn stop_request(runtime: &ServerRuntime) -> Option<StopRequest> {
    Some(StopRequest {
        stdin: runtime.stdin.clone()?,
        command: runtime.shutdown_commands.first().copied().unwrap_or("stop"),
    })
}

/// Gracefully terminates a runtime's child process: send the shutdown command,
/// wait briefly, then escalate to a kill. Used by `delete_server`, where we need
/// the process gone synchronously before touching the files. The runtime must
/// already be out of the `processes` map (this blocks for up to ~5s).
pub(in crate::app) fn terminate_runtime(runtime: &mut ServerRuntime) -> Result<(), String> {
    // Release a sleeping server's wake listener so its port is freed.
    if let Some(flag) = runtime.sleep_stop.take() {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    // Stop the playit tunnel agent alongside the server it fronts.
    if let Some(stop) = runtime.playit_stop.take() {
        playit::stop_agent(&stop);
    }

    if let Some(stop) = stop_request(runtime) {
        stop.send();
    }

    let Some(child) = runtime.child.as_mut() else {
        return Ok(());
    };
    let pid = child.id();

    for _ in 0..25 {
        match child.try_wait() {
            Ok(Some(_)) => {
                super::process::release_child_from_app_lifetime(pid);
                return Ok(());
            }
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(err) => return Err(err.to_string()),
        }
    }

    super::process::kill_child_process_group(child);
    child.kill().map_err(|err| err.to_string())?;
    child.wait().map_err(|err| err.to_string())?;
    super::process::release_child_from_app_lifetime(pid);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{next_lossy_line, trim_line_ending};

    #[test]
    fn trims_lf_and_crlf_only() {
        let mut lf = b"line\n".to_vec();
        trim_line_ending(&mut lf);
        assert_eq!(lf, b"line");

        let mut crlf = b"line\r\n".to_vec();
        trim_line_ending(&mut crlf);
        assert_eq!(crlf, b"line");

        let mut last = b"no newline".to_vec();
        trim_line_ending(&mut last);
        assert_eq!(last, b"no newline");
    }

    #[test]
    fn non_utf8_lines_decode_lossily_instead_of_ending_the_stream() {
        // Regression (R-020): `lines()` errors on invalid UTF-8 and the reader
        // used to stop there. Cp1252 "é" is 0xE9.
        let data: &[u8] = b"ok\n\xE9t\xE9\nafter\n";
        let mut reader = std::io::BufReader::new(data);
        let mut bytes = Vec::new();
        let lines: Vec<String> =
            std::iter::from_fn(|| next_lossy_line(&mut reader, &mut bytes)).collect();
        assert_eq!(lines, vec!["ok", "\u{FFFD}t\u{FFFD}", "after"]);
    }
}
