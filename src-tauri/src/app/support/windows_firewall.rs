use std::process::Command;

pub(in crate::app) fn add_windows_firewall_rule(port: u16, protocol: &str, direction: &str) -> Result<String, String> {
    let way = if direction.eq_ignore_ascii_case("in") {
        "Inbound"
    } else {
        "Outbound"
    };

    let rule_name = format!("MC Server {port} {protocol} {way} Allow");

    let _ = Command::new("netsh")
        .args([
            "advfirewall",
            "firewall",
            "delete",
            "rule",
            &format!("name={rule_name}"),
            &format!("protocol={protocol}"),
            &format!("localport={port}"),
        ])
        .output();

    let output = Command::new("netsh")
        .args([
            "advfirewall",
            "firewall",
            "add",
            "rule",
            &format!("name={rule_name}"),
            &format!("dir={direction}"),
            "action=allow",
            &format!("protocol={protocol}"),
            &format!("localport={port}"),
        ])
        .output()
        .map_err(|err| format!("Failed to run netsh: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let details = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "Unknown netsh error".to_string()
        };

        return Err(format!(
            "Failed creating firewall rule '{rule_name}'. Ensure mserve is running as administrator. {details}"
        ));
    }

    Ok(rule_name)
}

#[cfg(target_os = "windows")]
pub(in crate::app) fn firewall_rule_name(port: u16, protocol: &str, direction: &str) -> String {
    let way = if direction.eq_ignore_ascii_case("in") {
        "Inbound"
    } else {
        "Outbound"
    };
    format!("MC Server {port} {protocol} {way} Allow")
}

#[cfg(target_os = "windows")]
pub(in crate::app) fn is_windows_admin() -> Result<bool, String> {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
        ])
        .output()
        .map_err(|err| format!("Failed checking admin status: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Failed checking admin status.".to_string()
        } else {
            format!("Failed checking admin status: {stderr}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_ascii_lowercase();
    Ok(stdout == "true")
}

#[cfg(target_os = "windows")]
pub(in crate::app) fn forward_port_windows_firewall_elevated(port: u16) -> Result<Vec<String>, String> {
    let mut rule_names = Vec::with_capacity(4);
    let mut cmd_parts: Vec<String> = Vec::with_capacity(8);

    for protocol in ["TCP", "UDP"] {
        for direction in ["in", "out"] {
            let rule_name = firewall_rule_name(port, protocol, direction);
            rule_names.push(rule_name.clone());
            cmd_parts.push(format!(
                "netsh advfirewall firewall delete rule name=\"{rule_name}\" protocol={protocol} localport={port}"
            ));
            cmd_parts.push(format!(
                "netsh advfirewall firewall add rule name=\"{rule_name}\" dir={direction} action=allow protocol={protocol} localport={port}"
            ));
        }
    }

    let cmd_chain = cmd_parts.join(" & ");
    let escaped_cmd_chain = cmd_chain.replace('\'', "''");
    let script = format!(
        "$ErrorActionPreference = 'Stop'; $cmd = '{escaped_cmd_chain}'; $proc = Start-Process -FilePath cmd.exe -Verb RunAs -ArgumentList @('/d','/c',$cmd) -Wait -PassThru; exit $proc.ExitCode"
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|err| format!("Failed requesting administrator access: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let details = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "Unknown error while requesting administrator access.".to_string()
        };

        let lower = details.to_ascii_lowercase();
        if lower.contains("operation was canceled")
            || lower.contains("operation was cancelled")
            || lower.contains("canceled by the user")
            || lower.contains("cancelled by the user")
        {
            return Err("Administrator access was canceled. Please approve the UAC prompt to add firewall rules.".to_string());
        }

        return Err(format!(
            "Failed to add firewall rules with administrator access. {details}"
        ));
    }

    Ok(rule_names)
}

