//! Linux firewall provisioning — the counterpart of `windows_firewall.rs`.
//!
//! Opens a server port in whichever firewall manager the distro actually runs:
//! **firewalld** (Fedora/RHEL/openSUSE) or **ufw** (Ubuntu/Debian). When
//! neither is active the kernel isn't filtering inbound traffic, so there is
//! nothing to configure and the call succeeds with a note. Elevation goes
//! through `pkexec` (polkit) — the Linux analogue of the UAC flow on Windows.

use super::core::no_window_command;

fn is_root() -> bool {
    unsafe { libc::geteuid() == 0 }
}

fn command_exists(name: &str) -> bool {
    no_window_command("sh")
        .args(["-c", &format!("command -v {name}")])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// `firewall-cmd --state` prints `running` (exit 0) without privileges when the
/// firewalld daemon is active.
fn firewalld_running() -> bool {
    no_window_command("firewall-cmd")
        .arg("--state")
        .output()
        .map(|output| {
            output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "running"
        })
        .unwrap_or(false)
}

/// ufw's enabled flag lives in the world-readable `/etc/ufw/ufw.conf`, so we
/// can check it without prompting for a password.
fn ufw_enabled() -> bool {
    if !command_exists("ufw") {
        return false;
    }
    std::fs::read_to_string("/etc/ufw/ufw.conf")
        .map(|content| {
            content.lines().any(|line| {
                let line = line.trim();
                !line.starts_with('#') && line.replace(' ', "") == "ENABLED=yes"
            })
        })
        .unwrap_or(false)
}

/// Runs `program args…` directly when root, otherwise via `pkexec` (which shows
/// the desktop's polkit password prompt).
fn run_privileged(program: &str, args: &[&str]) -> Result<(), String> {
    let output = if is_root() {
        no_window_command(program).args(args).output()
    } else {
        if !command_exists("pkexec") {
            return Err(format!(
                "Administrator access is required but pkexec (polkit) is not installed. Run manually: sudo {program} {}",
                args.join(" ")
            ));
        }
        no_window_command("pkexec").arg(program).args(args).output()
    }
    .map_err(|err| format!("Failed to run {program}: {err}"))?;

    if output.status.success() {
        return Ok(());
    }

    // pkexec: 126 = dialog dismissed, 127 = authorization failed.
    if let Some(code) = output.status.code()
        && (code == 126 || code == 127)
    {
        return Err(
            "Administrator access was canceled. Please approve the password prompt to add firewall rules."
                .to_string(),
        );
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("{program} failed with no output.")
    };
    Err(format!(
        "Failed creating firewall rule ({program}). {details}"
    ))
}

/// Allows inbound TCP + UDP on `port` in the active firewall manager. Returns a
/// description of what was configured (mirrors the rule-name list the Windows
/// path returns).
pub(in crate::app) fn forward_port_linux_firewall(port: u16) -> Result<Vec<String>, String> {
    if firewalld_running() {
        for protocol in ["tcp", "udp"] {
            run_privileged(
                "firewall-cmd",
                &["--permanent", &format!("--add-port={port}/{protocol}")],
            )?;
        }
        run_privileged("firewall-cmd", &["--reload"])?;
        return Ok(vec![
            format!("firewalld: {port}/tcp"),
            format!("firewalld: {port}/udp"),
        ]);
    }

    if ufw_enabled() {
        // A bare port allows both TCP and UDP in one rule.
        run_privileged("ufw", &["allow", &port.to_string()])?;
        return Ok(vec![format!("ufw: allow {port} (TCP + UDP)")]);
    }

    Ok(vec![format!(
        "No active firewall (firewalld/ufw) detected — port {port} is not being blocked locally, so no rules were needed."
    )])
}
