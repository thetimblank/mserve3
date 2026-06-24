//! Persisted time-series store for telemetry samples (SQLite via rusqlite).
//!
//! Every running server contributes one row per sample. This is the foundation
//! for the future timeline graph: `query_range` returns bucket-averaged points
//! over an interval so a chart can request, say, 200 points across the last 24h
//! without pulling every raw row. A single connection guarded by a Mutex is
//! plenty for this write-light workload.

use super::super::*;
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

static STORE: OnceLock<Mutex<Connection>> = OnceLock::new();

/// Keep ~30 days of raw samples; older rows are pruned on startup.
const RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;

/// Opens (and migrates) the telemetry database. Safe to call once at startup.
pub(in crate::app) fn init_telemetry_store(db_path: &Path) -> Result<(), String> {
    if STORE.get().is_some() {
        return Ok(());
    }

    if let Some(parent) = db_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let connection = Connection::open(db_path).map_err(|err| err.to_string())?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS telemetry_samples (
                server_id TEXT NOT NULL,
                ts INTEGER NOT NULL,
                online INTEGER NOT NULL,
                players_online INTEGER,
                players_max INTEGER,
                tps REAL,
                ram_bytes INTEGER,
                ram_pct REAL,
                cpu_pct REAL
            );
            CREATE INDEX IF NOT EXISTS idx_samples_server_ts
                ON telemetry_samples (server_id, ts);",
        )
        .map_err(|err| err.to_string())?;

    let cutoff = chrono::Utc::now().timestamp_millis() - RETENTION_MS;
    let _ = connection.execute(
        "DELETE FROM telemetry_samples WHERE ts < ?1",
        params![cutoff],
    );

    STORE
        .set(Mutex::new(connection))
        .map_err(|_| "Telemetry store already initialized.".to_string())?;
    Ok(())
}

/// Appends one sample for a server. No-ops silently if the store is unavailable
/// or the server has no stable id yet (telemetry must never break the runtime).
pub(in crate::app) fn insert_sample(server_id: &str, sample: &TelemetrySample) {
    if server_id.trim().is_empty() {
        return;
    }
    let Some(lock) = STORE.get() else {
        return;
    };
    let Ok(connection) = lock.lock() else {
        return;
    };

    let _ = connection.execute(
        "INSERT INTO telemetry_samples
            (server_id, ts, online, players_online, players_max, tps, ram_bytes, ram_pct, cpu_pct)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            server_id,
            sample.timestamp,
            sample.online as i64,
            sample.players_online,
            sample.players_max,
            sample.tps,
            sample.ram_bytes.map(|bytes| bytes as i64),
            sample.ram_used,
            sample.cpu_used,
        ],
    );
}

/// Returns bucket-averaged history points over `[from_ts, to_ts]`, at most
/// roughly `max_points` of them. Used by the (future) telemetry graph.
pub(in crate::app) fn query_range(
    server_id: &str,
    from_ts: i64,
    to_ts: i64,
    max_points: usize,
) -> Vec<TelemetryHistoryPoint> {
    let Some(lock) = STORE.get() else {
        return Vec::new();
    };
    let Ok(connection) = lock.lock() else {
        return Vec::new();
    };

    let span = (to_ts - from_ts).max(1);
    let bucket_count = max_points.max(1) as i64;
    let bucket_size = (span / bucket_count).max(1);

    let mut statement = match connection.prepare(
        "SELECT (ts / ?1) * ?1 AS bucket,
                AVG(CASE WHEN online != 0 THEN 1.0 ELSE 0.0 END),
                AVG(players_online),
                AVG(tps),
                AVG(ram_bytes),
                AVG(ram_pct),
                AVG(cpu_pct)
         FROM telemetry_samples
         WHERE server_id = ?2 AND ts >= ?3 AND ts <= ?4
         GROUP BY bucket
         ORDER BY bucket ASC",
    ) {
        Ok(statement) => statement,
        Err(_) => return Vec::new(),
    };

    let rows = statement.query_map(
        params![bucket_size, server_id, from_ts, to_ts],
        |row| {
            let online_avg: f64 = row.get::<_, Option<f64>>(1)?.unwrap_or(0.0);
            Ok(TelemetryHistoryPoint {
                timestamp: row.get::<_, i64>(0)?,
                online: online_avg >= 0.5,
                players_online: row.get::<_, Option<f64>>(2)?.map(|value| value.round() as u32),
                tps: row.get::<_, Option<f64>>(3)?,
                ram_bytes: row.get::<_, Option<f64>>(4)?.map(|value| value as u64),
                ram_used: row.get::<_, Option<f64>>(5)?,
                cpu_used: row.get::<_, Option<f64>>(6)?,
            })
        },
    );

    match rows {
        Ok(iterator) => iterator.filter_map(Result::ok).collect(),
        Err(_) => Vec::new(),
    }
}
