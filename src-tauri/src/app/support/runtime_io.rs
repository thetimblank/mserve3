use super::super::*;
use std::io::{BufRead, BufReader, Write};
use std::thread;
use std::time::Duration;
use tauri::Emitter;

pub(in crate::app) fn emit_output_reader<R: std::io::Read + Send + 'static>(
    reader: R,
    directory: String,
    stream: &'static str,
    app: tauri::AppHandle,
) {
    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines().flatten() {
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

pub(in crate::app) fn drain_reader<R: std::io::Read + Send + 'static>(reader: R) {
    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for _ in buffered.lines() {}
    });
}

pub(in crate::app) fn stop_child_process(process: &mut RunningServerProcess) -> Result<(), String> {
    let _ = writeln!(process.stdin, "stop");
    let _ = process.stdin.flush();

    for _ in 0..25 {
        match process.child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(err) => return Err(err.to_string()),
        }
    }

    process.child.kill().map_err(|err| err.to_string())?;
    process.child.wait().map_err(|err| err.to_string())?;
    Ok(())
}

