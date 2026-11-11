//! UPnP router port forwarding per server: the setting toggle, the status
//! snapshot, the setup guide's router check, and the per-run mapping task that
//! the start path launches. The router I/O lives in `support/upnp.rs`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::State;
use tokio_util::sync::CancellationToken;

use super::super::support::upnp;
use super::super::support::{emit_system_line, get_runtime_config, patch_mserve_json, server_key};
use super::super::{LifecycleState, RuntimeState, ServerRuntime, ServerUpnpInfo};
use super::run_blocking;

type Processes = Arc<Mutex<HashMap<String, ServerRuntime>>>;

/// The router mapping description for a server (its folder name).
fn description_for(directory: &str) -> String {
    let name = PathBuf::from(directory.trim())
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("server")
        .to_string();
    upnp::mapping_description(&name)
}

/// Runs `update` on this run's runtime entry, but only while the UPnP task that
/// holds `cancel` is still the current one (a newer run or a toggle cancels it).
fn with_current_run(
    processes: &Processes,
    key: &str,
    generation: u64,
    cancel: &CancellationToken,
    update: impl FnOnce(&mut ServerRuntime),
) {
    if cancel.is_cancelled() {
        return;
    }
    if let Ok(mut guard) = processes.lock()
        && let Some(runtime) = guard.get_mut(key)
        && runtime.generation == generation
    {
        update(runtime);
    }
}

/// Starts this run's UPnP router forward (when `upnp_enabled`) off the start
/// path, so router I/O never blocks or fails a server start. The stop handle is
/// attached before any network I/O, so every teardown path cancels it, even while
/// the router request is still in flight.
pub(in crate::app) fn launch_upnp(
    app: tauri::AppHandle,
    processes: Processes,
    key: String,
    directory: String,
    enabled: bool,
    server_port: u16,
    generation: u64,
) {
    if !enabled {
        return;
    }
    let cancel = CancellationToken::new();
    let attached = processes
        .lock()
        .is_ok_and(|mut guard| match guard.get_mut(&key) {
            Some(runtime)
                if runtime.generation == generation
                    && runtime.child.is_some()
                    && !runtime.stop_requested =>
            {
                if let Some(previous) = runtime.upnp_stop.replace(cancel.clone()) {
                    previous.cancel();
                }
                runtime.upnp_address = None;
                runtime.upnp_error = None;
                true
            }
            _ => false,
        });
    if !attached {
        return;
    }

    upnp::emit_upnp_state(&app, &directory, "starting", None, None);
    let description = description_for(&directory);
    let owner = upnp::new_owner();
    tauri::async_runtime::spawn(run_mapping(
        app,
        processes,
        key,
        directory,
        server_port,
        generation,
        owner,
        description,
        cancel,
    ));
}

/// One run's mapping lifecycle: claim the forward, renew it while the server
/// runs, and remove it once cancelled (unless a newer run took the port over).
#[allow(clippy::too_many_arguments)]
async fn run_mapping(
    app: tauri::AppHandle,
    processes: Processes,
    key: String,
    directory: String,
    port: u16,
    generation: u64,
    owner: u64,
    description: String,
    cancel: CancellationToken,
) {
    let claim_description = description.clone();
    let mapping =
        match run_blocking(move || upnp::claim_mapping(owner, port, &claim_description)).await {
            Ok(mapping) => mapping,
            Err(err) => {
                with_current_run(&processes, &key, generation, &cancel, |runtime| {
                    runtime.upnp_stop = None;
                    runtime.upnp_error = Some(err.clone());
                });
                if !cancel.is_cancelled() {
                    emit_system_line(&app, &directory, format!("UPnP port forward failed: {err}"));
                    upnp::emit_upnp_state(&app, &directory, "error", None, Some(err));
                }
                return;
            }
        };

    let address = mapping.address(port);
    if !cancel.is_cancelled() {
        with_current_run(&processes, &key, generation, &cancel, |runtime| {
            runtime.upnp_address = Some(address.clone());
        });
        emit_system_line(
            &app,
            &directory,
            format!(
                "Your router now forwards port {port} to this PC (UPnP). Players can join at {address}."
            ),
        );
        upnp::emit_upnp_state(&app, &directory, "active", Some(address), None);

        if mapping.permanent {
            cancel.cancelled().await;
        } else {
            // Renew well inside the lease until the server stops.
            while tokio::time::timeout(upnp::RENEW_INTERVAL, cancel.cancelled())
                .await
                .is_err()
            {
                let renew_description = description.clone();
                let renewed = tauri::async_runtime::spawn_blocking(move || {
                    upnp::renew_mapping(owner, port, &renew_description)
                })
                .await;
                match renewed {
                    // A newer run owns the port now; it handles the mapping.
                    Ok(None) => return,
                    Ok(Some(Err(err))) => emit_system_line(
                        &app,
                        &directory,
                        format!("Couldn't renew the UPnP port forward: {err}"),
                    ),
                    Ok(Some(Ok(_))) | Err(_) => {}
                }
            }
        }
    }

    let released = tauri::async_runtime::spawn_blocking(move || upnp::release_mapping(owner, port))
        .await
        .unwrap_or(false);
    if released {
        upnp::emit_upnp_state(&app, &directory, "off", None, None);
    }
}

/// Turns automatic router forwarding (UPnP) on or off for a server. Persists to
/// `mserve.json`; a running server forwards or releases the port right away.
#[tauri::command]
pub(in crate::app) fn set_server_upnp(
    directory: String,
    enabled: bool,
    state: State<'_, RuntimeState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let directory_path = PathBuf::from(directory.trim());
    if !directory_path.is_dir() {
        return Err("Server directory does not exist.".to_string());
    }
    patch_mserve_json(
        &directory_path,
        &[("upnp_enabled", serde_json::json!(enabled))],
    )?;

    let key = server_key(&directory);
    let processes = state.processes.clone();
    let start = {
        let mut guard = processes.lock().map_err(|_| "Runtime lock failed.")?;
        match guard.get_mut(&key) {
            Some(runtime) => {
                let running = runtime.child.is_some()
                    && !matches!(
                        runtime.state,
                        LifecycleState::Offline | LifecycleState::Crashed
                    );
                if !enabled {
                    // The mapping task removes the forward and emits "off".
                    if let Some(stop) = runtime.upnp_stop.take() {
                        stop.cancel();
                    }
                    runtime.upnp_address = None;
                    runtime.upnp_error = None;
                    None
                } else if running && runtime.upnp_stop.is_none() {
                    Some((runtime.server_port, runtime.generation))
                } else {
                    None
                }
            }
            None => None,
        }
    };

    if let Some((port, generation)) = start {
        launch_upnp(app, processes, key, directory, true, port, generation);
    }
    Ok(())
}

/// The current UPnP forward state for a server (for a freshly mounted UI).
#[tauri::command]
pub(in crate::app) fn get_server_upnp(
    directory: String,
    state: State<'_, RuntimeState>,
) -> Result<ServerUpnpInfo, String> {
    let directory_path = PathBuf::from(directory.trim());
    let enabled = get_runtime_config(&directory_path).is_ok_and(|config| config.upnp_enabled);

    let key = server_key(&directory);
    let guard = state.processes.lock().map_err(|_| "Runtime lock failed.")?;
    let runtime = guard.get(&key);

    let (status, address, error) = match runtime {
        Some(rt) if rt.upnp_address.is_some() => ("active", rt.upnp_address.clone(), None),
        Some(rt) if rt.upnp_stop.is_some() => ("starting", None, None),
        Some(rt) if enabled && rt.upnp_error.is_some() => ("error", None, rt.upnp_error.clone()),
        _ if enabled => ("off", None, None),
        _ => ("disabled", None, None),
    };

    Ok(ServerUpnpInfo {
        enabled,
        status: status.to_string(),
        address,
        error,
    })
}

/// Setup guide check: can this router forward `port` automatically? Maps the port
/// briefly and removes it again. Resolves to the public IP players would join on,
/// or an error explaining why it can't work (UPnP off, CGNAT, port taken).
#[tauri::command]
pub(in crate::app) async fn check_upnp(port: u16) -> Result<String, String> {
    if port == 0 {
        return Err("Port must be between 1 and 65535.".to_string());
    }
    run_blocking(move || upnp::check_upnp(port)).await
}
