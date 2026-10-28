use super::super::TelemetryHistoryPoint;
use super::super::support::query_range;

/// Returns bucket-averaged telemetry history for the Statistics tab and the
/// dashboard. `from_ts`/`to_ts` are unix epoch milliseconds.
#[tauri::command]
pub(in crate::app) fn get_server_telemetry_history(
    server_id: String,
    from_ts: i64,
    to_ts: i64,
    max_points: usize,
) -> Result<Vec<TelemetryHistoryPoint>, String> {
    Ok(query_range(&server_id, from_ts, to_ts, max_points.max(1)))
}
