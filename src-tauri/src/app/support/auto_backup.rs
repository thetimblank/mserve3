//! Automatic backups (mserve.json `auto_backup`: `on_start`, `on_close`,
//! `interval`). The supervisor triggers them, so they run whether or not the
//! server's page (or the app window) is open, the same as backend auto-restart.
//! Each finished attempt emits `server-backups-changed` so the UI can rescan.

use super::backups::{ensure_not_proxy, is_restoring, snapshot_then_retain};
use super::core::{get_runtime_config, server_key};
use super::runtime_io::emit_system_line;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

pub(in crate::app) const BACKUPS_CHANGED_EVENT: &str = "server-backups-changed";

/// The default interval, matching `default_auto_backup_interval` in mserve.json.
const DEFAULT_INTERVAL_MINUTES: u32 = 120;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::app) enum AutoBackupReason {
    OnStart,
    OnClose,
    Interval,
}

impl AutoBackupReason {
    /// The mserve.json mode name, also stored as the backup's `reason`.
    fn mode(self) -> &'static str {
        match self {
            Self::OnStart => "on_start",
            Self::OnClose => "on_close",
            Self::Interval => "interval",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::OnStart => "on start",
            Self::OnClose => "on close",
            Self::Interval => "interval",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerBackupsChangedEvent {
    directory: String,
    reason: String,
    deleted_backups_count: usize,
    error: Option<String>,
}

/// The auto-backup settings in effect. Read from mserve.json at each trigger,
/// so edits made while the server runs apply to the next one.
#[derive(Debug, PartialEq)]
pub(in crate::app) struct AutoBackupSettings {
    modes: Vec<String>,
    interval: Duration,
}

impl AutoBackupSettings {
    fn from_config(modes: Option<Vec<String>>, interval_minutes: Option<u32>) -> Self {
        let minutes = interval_minutes.unwrap_or(DEFAULT_INTERVAL_MINUTES).max(1);
        Self {
            modes: modes.unwrap_or_default(),
            interval: Duration::from_secs(u64::from(minutes) * 60),
        }
    }

    /// No modes enabled when mserve.json can't be read.
    pub(in crate::app) fn load(directory: &str) -> Self {
        match get_runtime_config(&PathBuf::from(directory.trim())) {
            Ok(config) => Self::from_config(config.auto_backup, config.auto_backup_interval),
            Err(_) => Self::from_config(None, None),
        }
    }

    pub(in crate::app) fn enabled(&self, reason: AutoBackupReason) -> bool {
        self.modes.iter().any(|mode| mode == reason.mode())
    }

    pub(in crate::app) fn interval(&self) -> Duration {
        self.interval
    }
}

/// Server keys with an automatic backup running, so a slow backup and the next
/// trigger never copy the same server at once, and starts/restores wait for it.
static IN_FLIGHT: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// How often waiters re-check [`IN_FLIGHT`].
const IN_FLIGHT_POLL: Duration = Duration::from_millis(250);
/// The longest a start waits for an automatic backup of its server to finish.
const START_WAIT_LIMIT: Duration = Duration::from_secs(15 * 60);

struct InFlight(String);

impl InFlight {
    fn claim(key: String) -> Option<Self> {
        let mut in_flight = IN_FLIGHT.lock().ok()?;
        if in_flight.contains(&key) {
            return None;
        }
        in_flight.push(key.clone());
        Some(Self(key))
    }

    /// Waits for a running automatic backup of the same server, then claims.
    fn claim_after_running(key: String) -> Option<Self> {
        loop {
            if let Some(claim) = Self::claim(key.clone()) {
                return Some(claim);
            }
            if IN_FLIGHT.lock().is_err() {
                return None;
            }
            std::thread::sleep(IN_FLIGHT_POLL);
        }
    }
}

/// True while an automatic backup of the server with this key is copying files.
pub(in crate::app) fn is_auto_backup_running(key: &str) -> bool {
    IN_FLIGHT
        .lock()
        .is_ok_and(|in_flight| in_flight.iter().any(|running| running == key))
}

/// Blocks a start until an automatic backup of the same server has finished,
/// so a new JVM never writes the world while it's being copied (a restart, a
/// wake, or a start clicked right after a stop).
pub(in crate::app) fn wait_for_auto_backup(
    app: &tauri::AppHandle,
    directory: &str,
) -> Result<(), String> {
    let key = server_key(directory);
    if !is_auto_backup_running(&key) {
        return Ok(());
    }
    emit_system_line(
        app,
        directory,
        "Waiting for the automatic backup to finish before starting...",
    );
    let started = std::time::Instant::now();
    while is_auto_backup_running(&key) {
        if started.elapsed() >= START_WAIT_LIMIT {
            return Err(
                "An automatic backup of this server is still running. Try again when it's done."
                    .to_string(),
            );
        }
        std::thread::sleep(IN_FLIGHT_POLL);
    }
    Ok(())
}

impl Drop for InFlight {
    fn drop(&mut self) {
        if let Ok(mut in_flight) = IN_FLIGHT.lock() {
            in_flight.retain(|key| key != &self.0);
        }
    }
}

/// The claim on a server's automatic backup slot, taken before the backup runs.
/// While it's held, starts wait and restores are refused.
pub(in crate::app) struct AutoBackupClaim(InFlight);

/// Claims the backup slot without waiting. The supervisor takes this for the
/// on-close backup before it announces the exit, so no start can slip in
/// between the process exiting and the backup beginning.
pub(in crate::app) fn try_claim_auto_backup(directory: &str) -> Option<AutoBackupClaim> {
    InFlight::claim(server_key(directory)).map(AutoBackupClaim)
}

/// Takes an automatic backup if `reason` is enabled for the server. Blocking.
/// Skips proxies (no worlds) and servers being restored. If another automatic
/// backup of the server is running, an on-close backup waits for it (the final
/// saved state matters most) and the others are skipped. `claim` is one already
/// taken with [`try_claim_auto_backup`].
pub(in crate::app) fn run_auto_backup(
    app: &tauri::AppHandle,
    directory: &str,
    reason: AutoBackupReason,
    claim: Option<AutoBackupClaim>,
) {
    let key = server_key(directory);
    let claim = match claim {
        Some(AutoBackupClaim(claim)) => Some(claim),
        None if reason == AutoBackupReason::OnClose => InFlight::claim_after_running(key.clone()),
        None => InFlight::claim(key.clone()),
    };
    let Some(_claim) = claim else {
        return;
    };
    if !AutoBackupSettings::load(directory).enabled(reason) {
        return;
    }
    let path = PathBuf::from(directory.trim());
    if ensure_not_proxy(&path).is_err() || is_restoring(&key) {
        return;
    }

    let (deleted_backups_count, error) = match snapshot_then_retain(&path, None, reason.mode(), &[])
    {
        Ok((_, deleted)) => {
            emit_system_line(
                app,
                directory,
                format!("Auto backup created ({}).", reason.label()),
            );
            (deleted, None)
        }
        Err(err) => {
            emit_system_line(app, directory, format!("Auto backup failed: {err}"));
            (0, Some(err))
        }
    };
    let _ = app.emit(
        BACKUPS_CHANGED_EVENT,
        ServerBackupsChangedEvent {
            directory: directory.to_string(),
            reason: reason.mode().to_string(),
            deleted_backups_count,
            error,
        },
    );
}

/// [`run_auto_backup`] on its own thread, for triggers that fire while the
/// server is running (the supervisor must keep polling).
pub(in crate::app) fn spawn_auto_backup(
    app: tauri::AppHandle,
    directory: String,
    reason: AutoBackupReason,
) {
    std::thread::spawn(move || run_auto_backup(&app, &directory, reason, None));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_enable_only_the_listed_modes() {
        let settings = AutoBackupSettings::from_config(
            Some(vec!["on_close".to_string(), "interval".to_string()]),
            Some(30),
        );
        assert!(settings.enabled(AutoBackupReason::OnClose));
        assert!(settings.enabled(AutoBackupReason::Interval));
        assert!(!settings.enabled(AutoBackupReason::OnStart));
        assert_eq!(settings.interval(), Duration::from_secs(30 * 60));
    }

    #[test]
    fn settings_default_to_nothing_enabled_and_a_floor_of_one_minute() {
        let missing = AutoBackupSettings::from_config(None, None);
        assert!(!missing.enabled(AutoBackupReason::OnStart));
        assert_eq!(missing.interval(), Duration::from_secs(120 * 60));
        let zero = AutoBackupSettings::from_config(None, Some(0));
        assert_eq!(zero.interval(), Duration::from_secs(60));
    }

    #[test]
    fn in_flight_claims_are_exclusive_per_server_until_dropped() {
        let first = InFlight::claim("test-auto-backup-key".to_string());
        assert!(first.is_some());
        assert!(InFlight::claim("test-auto-backup-key".to_string()).is_none());
        drop(first);
        assert!(InFlight::claim("test-auto-backup-key".to_string()).is_some());
    }
}
