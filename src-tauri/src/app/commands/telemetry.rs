use super::super::support::{
    collect_status_ping, get_runtime_config, infer_provider_version, query_range,
    resolve_telemetry_target, server_key,
};
use super::super::{RuntimeState, TelemetryHistoryPoint, TelemetrySample};
use std::path::PathBuf;
use std::time::Duration;
use tauri::State;
use tauri::async_runtime::spawn_blocking;

/// Returns the latest telemetry sample for a server. The supervisor keeps this
/// fresh while a server runs; if there is no live sample we fall back to a
/// one-shot status ping (no process metrics) so callers still get online/players.
#[tauri::command]
pub(in crate::app) async fn get_server_telemetry(
    directory: String,
    state: State<'_, RuntimeState>,
) -> Result<TelemetrySample, String> {
    let key = server_key(&directory);
    {
        let guard = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
        if let Some(runtime) = guard.get(&key)
            && let Some(sample) = runtime.latest_sample.clone()
        {
            return Ok(sample);
        }
    }

    let directory_path = PathBuf::from(directory.trim());
    let config = get_runtime_config(&directory_path).unwrap_or_default();
    let (host, port) = resolve_telemetry_target(&config, &directory_path);
    let provider_version = infer_provider_version(&config);

    let ping = spawn_blocking(move || collect_status_ping(&host, port, Duration::from_millis(650)))
        .await
        .map_err(|err| err.to_string())?;

    Ok(TelemetrySample {
        timestamp: chrono::Utc::now().timestamp_millis(),
        online: ping.online,
        players_online: ping.players_online,
        players_max: ping.players_max,
        server_version: ping.server_version,
        provider_version,
        tps: None,
        ram_used: None,
        ram_bytes: None,
        cpu_used: None,
        uptime: None,
    })
}

/// Returns bucket-averaged telemetry history for the (future) timeline graph.
/// `from_ts`/`to_ts` are unix epoch milliseconds.
#[tauri::command]
pub(in crate::app) fn get_server_telemetry_history(
    server_id: String,
    from_ts: i64,
    to_ts: i64,
    max_points: usize,
) -> Result<Vec<TelemetryHistoryPoint>, String> {
    Ok(query_range(&server_id, from_ts, to_ts, max_points.max(1)))
}
