//! playit.gg account commands (global, install-wide). Per-server tunnel
//! enable/disable + status live in `runtime.rs` since they touch the runtime map.

use super::super::PlayitStatus;
use super::super::support::playit;

/// Whether a global playit.gg account secret has been claimed for this install.
#[tauri::command]
pub(in crate::app) fn get_playit_status(app: tauri::AppHandle) -> Result<PlayitStatus, String> {
    Ok(PlayitStatus {
        claimed: playit::is_claimed(&app),
    })
}

/// Begins the playit.gg claim flow: returns the browser URL the user must visit
/// to approve, and continues polling for approval in the background (emitting
/// `playit-claim-state` events and persisting the secret on success).
#[tauri::command]
pub(in crate::app) fn start_playit_claim(app: tauri::AppHandle) -> Result<String, String> {
    let code = playit::generate_claim_code();
    let url = playit::claim_url(&code);
    tauri::async_runtime::spawn(playit::drive_claim(app, code));
    Ok(url)
}

/// Forgets the stored playit.gg secret so the install can be re-claimed.
#[tauri::command]
pub(in crate::app) fn disconnect_playit_account(app: tauri::AppHandle) -> Result<(), String> {
    playit::clear_secret(&app)
}
