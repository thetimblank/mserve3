use super::super::support::*;
use super::super::*;
use std::path::PathBuf;

fn system_memory_bytes() -> Result<u64, String> {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory",
            ])
            .output()
            .map_err(|err| format!("Failed to query system memory: {err}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let details = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                "Unknown error while reading system memory.".to_string()
            };
            return Err(details);
        }

        let raw = String::from_utf8_lossy(&output.stdout);
        let bytes = raw
            .split_whitespace()
            .next()
            .ok_or_else(|| "System memory output was empty.".to_string())?
            .parse::<u64>()
            .map_err(|err| format!("Failed to parse system memory bytes: {err}"))?;

        return Ok(bytes);
    }

    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .map_err(|err| format!("Failed to query system memory: {err}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "Failed to query system memory.".to_string()
            } else {
                stderr
            });
        }

        let bytes = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u64>()
            .map_err(|err| format!("Failed to parse system memory bytes: {err}"))?;

        return Ok(bytes);
    }

    #[cfg(target_os = "linux")]
    {
        let meminfo = std::fs::read_to_string("/proc/meminfo")
            .map_err(|err| format!("Failed to read /proc/meminfo: {err}"))?;

        let mem_total_kb = meminfo
            .lines()
            .find(|line| line.starts_with("MemTotal:"))
            .and_then(|line| line.split_whitespace().nth(1))
            .ok_or_else(|| "MemTotal could not be found in /proc/meminfo.".to_string())?
            .parse::<u64>()
            .map_err(|err| format!("Failed to parse MemTotal value: {err}"))?;

        return Ok(mem_total_kb.saturating_mul(1024));
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("System memory command is not supported on this platform.".to_string())
    }
}

#[tauri::command]
pub(in crate::app) fn get_system_memory_gb() -> Result<u32, String> {
    let bytes = system_memory_bytes()?;
    let gib = ((bytes as f64) / (1024_f64 * 1024_f64 * 1024_f64)).ceil() as u32;
    Ok(gib.max(1))
}

#[tauri::command]
pub(in crate::app) fn forward_port_windows_firewall(port: u16) -> Result<Vec<String>, String> {
    if port == 0 {
        return Err("Port must be between 1 and 65535.".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = port;
        return Err("Windows Defender Firewall forwarding is only supported on Windows.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !is_windows_admin()? {
            return forward_port_windows_firewall_elevated(port);
        }

        let mut created = Vec::with_capacity(4);
        for protocol in ["TCP", "UDP"] {
            for direction in ["in", "out"] {
                created.push(add_windows_firewall_rule(port, protocol, direction)?);
            }
        }
        Ok(created)
    }
}

#[tauri::command]
pub(in crate::app) fn validate_path(path: String) -> Result<PathValidationResult, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(PathValidationResult {
            exists: false,
            is_directory: false,
            is_file: false,
        });
    }

    let candidate = PathBuf::from(trimmed);
    Ok(PathValidationResult {
        exists: candidate.exists(),
        is_directory: candidate.is_dir(),
        is_file: candidate.is_file(),
    })
}

#[tauri::command]
pub(in crate::app) fn get_local_ip() -> Result<String, String> {
    resolve_local_ip().ok_or_else(|| "Unable to determine local IP address.".to_string())
}

