mod backups;
mod config_files;
mod items;
mod java;
mod java_download;
mod modpack;
mod modrinth;
mod navigation;
mod network;
mod networks;
mod playit;
mod providers;
mod runtime;
mod settings;
mod setup;
mod telemetry;

pub(super) use backups::*;
pub(super) use config_files::*;
pub(super) use items::*;
pub(super) use java::*;
pub(super) use java_download::*;
pub(super) use modpack::*;
pub(super) use modrinth::*;
pub(super) use navigation::*;
pub(super) use network::*;
pub(super) use networks::*;
pub(super) use playit::*;
pub(super) use providers::*;
pub(super) use runtime::*;
pub(super) use settings::*;
pub(super) use setup::*;
pub(super) use telemetry::*;

/// Runs blocking command work (downloads, spawns, port probes, RCON, bulk file
/// I/O, bounded waits) on the blocking pool. Synchronous Tauri commands execute
/// on the main thread, so doing this inline would freeze the window.
async fn run_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| err.to_string())?
}
