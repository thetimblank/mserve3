use super::super::*;
use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone)]
struct JavaCandidate {
    path: PathBuf,
    source: &'static str,
}

fn candidate_key(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        return value.to_lowercase();
    }

    #[cfg(not(target_os = "windows"))]
    {
        value
    }
}

fn normalize_candidate_path(path: PathBuf) -> PathBuf {
    path.canonicalize().unwrap_or(path)
}

fn push_candidate(
    candidates: &mut Vec<JavaCandidate>,
    seen: &mut HashSet<String>,
    path: PathBuf,
    source: &'static str,
) {
    if !path.exists() || !path.is_file() {
        return;
    }

    let normalized = normalize_candidate_path(path);
    let key = candidate_key(&normalized);

    if seen.insert(key) {
        candidates.push(JavaCandidate {
            path: normalized,
            source,
        });
    }
}

fn collect_java_home_candidate(candidates: &mut Vec<JavaCandidate>, seen: &mut HashSet<String>) {
    let Ok(java_home) = env::var("JAVA_HOME") else {
        return;
    };

    let trimmed = java_home.trim();
    if trimmed.is_empty() {
        return;
    }

    #[cfg(target_os = "windows")]
    let executable_name = "java.exe";
    #[cfg(not(target_os = "windows"))]
    let executable_name = "java";

    push_candidate(
        candidates,
        seen,
        PathBuf::from(trimmed).join("bin").join(executable_name),
        "java_home",
    );
}

fn collect_path_candidates(
    candidates: &mut Vec<JavaCandidate>,
    seen: &mut HashSet<String>,
    errors: &mut Vec<String>,
) {
    #[cfg(target_os = "windows")]
    let output = Command::new("where").arg("java").output();

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("which").args(["-a", "java"]).output();

    let result = match output {
        Ok(value) => value,
        Err(err) => {
            errors.push(format!("Could not inspect PATH for Java executables: {err}"));
            return;
        }
    };

    if !result.status.success() {
        return;
    }

    let stdout = String::from_utf8_lossy(&result.stdout);
    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        push_candidate(candidates, seen, PathBuf::from(line), "path");
    }
}

#[cfg(target_os = "windows")]
fn collect_windows_common_candidates(candidates: &mut Vec<JavaCandidate>, seen: &mut HashSet<String>) {
    const VENDOR_ROOTS: [&str; 11] = [
        "Java",
        "Eclipse Adoptium",
        "Adoptium",
        "AdoptOpenJDK",
        "Amazon Corretto",
        "Zulu",
        "BellSoft",
        "Microsoft",
        "Semeru",
        "RedHat",
        "GraalVM",
    ];

    let mut base_dirs: Vec<PathBuf> = Vec::new();
    for key in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        let Ok(value) = env::var(key) else {
            continue;
        };

        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }

        base_dirs.push(PathBuf::from(trimmed));
    }

    base_dirs.push(PathBuf::from(r"C:\Program Files"));
    base_dirs.push(PathBuf::from(r"C:\Program Files (x86)"));

    let mut unique_base_dirs: Vec<PathBuf> = Vec::new();
    let mut base_seen = HashSet::new();

    for base in base_dirs {
        let key = candidate_key(&base);
        if base_seen.insert(key) {
            unique_base_dirs.push(base);
        }
    }

    for base_dir in unique_base_dirs {
        for vendor in VENDOR_ROOTS {
            let vendor_root = base_dir.join(vendor);
            if !vendor_root.exists() || !vendor_root.is_dir() {
                continue;
            }

            push_candidate(
                candidates,
                seen,
                vendor_root.join("bin").join("java.exe"),
                "common_install_dir",
            );

            let Ok(entries) = std::fs::read_dir(&vendor_root) else {
                continue;
            };

            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                push_candidate(
                    candidates,
                    seen,
                    path.join("bin").join("java.exe"),
                    "common_install_dir",
                );

                let Ok(nested_entries) = std::fs::read_dir(&path) else {
                    continue;
                };

                for nested in nested_entries.flatten() {
                    let nested_path = nested.path();
                    if !nested_path.is_dir() {
                        continue;
                    }

                    push_candidate(
                        candidates,
                        seen,
                        nested_path.join("bin").join("java.exe"),
                        "common_install_dir",
                    );
                }
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn collect_windows_common_candidates(
    _candidates: &mut Vec<JavaCandidate>,
    _seen: &mut HashSet<String>,
) {
}

fn extract_java_version(version_output: &str) -> Option<String> {
    for line in version_output.lines() {
        if !line.to_ascii_lowercase().contains("version") {
            continue;
        }

        if let Some(start) = line.find('"') {
            let remaining = &line[(start + 1)..];
            if let Some(end) = remaining.find('"') {
                let candidate = remaining[..end].trim();
                if !candidate.is_empty() {
                    return Some(candidate.to_string());
                }
            }
        }
    }

    for token in version_output.split_whitespace() {
        let cleaned = token.trim_matches(|ch: char| {
            !ch.is_ascii_alphanumeric() && ch != '.' && ch != '_' && ch != '-'
        });

        if cleaned.is_empty() {
            continue;
        }

        let starts_with_digit = cleaned
            .chars()
            .next()
            .map(|value| value.is_ascii_digit())
            .unwrap_or(false);

        if starts_with_digit && cleaned.contains('.') {
            return Some(cleaned.to_string());
        }
    }

    None
}

fn parse_java_major(version: &str) -> Option<u32> {
    if let Some(legacy) = version.strip_prefix("1.") {
        return legacy.split('.').next()?.parse::<u32>().ok();
    }

    let major_digits: String = version
        .chars()
        .take_while(|value| value.is_ascii_digit())
        .collect();

    if major_digits.is_empty() {
        return None;
    }

    major_digits.parse::<u32>().ok()
}

fn infer_java_vendor(version_output: &str, path: &Path) -> String {
    let source = format!(
        "{}\n{}",
        version_output.to_lowercase(),
        path.to_string_lossy().to_lowercase()
    );

    if source.contains("temurin") || source.contains("eclipse adoptium") {
        return "Eclipse Temurin".to_string();
    }

    if source.contains("microsoft") {
        return "Microsoft OpenJDK".to_string();
    }

    if source.contains("corretto") {
        return "Amazon Corretto".to_string();
    }

    if source.contains("oracle") {
        return "Oracle".to_string();
    }

    if source.contains("zulu") {
        return "Zulu OpenJDK".to_string();
    }

    if source.contains("semeru") {
        return "IBM Semeru".to_string();
    }

    if source.contains("graalvm") {
        return "GraalVM".to_string();
    }

    if source.contains("openjdk") {
        return "OpenJDK".to_string();
    }

    "Unknown".to_string()
}

fn inspect_java_candidate(candidate: &JavaCandidate) -> Result<JavaRuntimeInfo, String> {
    let output = Command::new(&candidate.path)
        .arg("-version")
        .output()
        .map_err(|err| {
            format!(
                "{} ({}) could not be executed: {err}",
                candidate.path.to_string_lossy(),
                candidate.source
            )
        })?;

    let combined_output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );

    if combined_output.trim().is_empty() {
        return Err(format!(
            "{} ({}) did not return version details.",
            candidate.path.to_string_lossy(),
            candidate.source
        ));
    }

    let version = extract_java_version(&combined_output).ok_or_else(|| {
        format!(
            "{} ({}) returned version output that could not be parsed.",
            candidate.path.to_string_lossy(),
            candidate.source
        )
    })?;

    let major_version = parse_java_major(&version).ok_or_else(|| {
        format!(
            "{} ({}) has an unsupported version format: {version}",
            candidate.path.to_string_lossy(),
            candidate.source
        )
    })?;

    Ok(JavaRuntimeInfo {
        executable_path: candidate.path.to_string_lossy().to_string(),
        major_version,
        version,
        vendor: infer_java_vendor(&combined_output, &candidate.path),
        source: candidate.source.to_string(),
    })
}

#[tauri::command]
pub(in crate::app) fn detect_java_runtimes() -> Result<JavaRuntimeDetectionResult, String> {
    let mut candidates = Vec::new();
    let mut seen_candidates = HashSet::new();
    let mut errors = Vec::new();

    collect_java_home_candidate(&mut candidates, &mut seen_candidates);
    collect_path_candidates(&mut candidates, &mut seen_candidates, &mut errors);
    collect_windows_common_candidates(&mut candidates, &mut seen_candidates);

    let scanned_candidates = candidates.len();
    let mut runtimes = Vec::new();

    for candidate in candidates {
        match inspect_java_candidate(&candidate) {
            Ok(runtime) => runtimes.push(runtime),
            Err(err) => errors.push(err),
        }
    }

    runtimes.sort_by(|left, right| {
        right
            .major_version
            .cmp(&left.major_version)
            .then_with(|| left.executable_path.cmp(&right.executable_path))
    });

    Ok(JavaRuntimeDetectionResult {
        runtimes,
        errors,
        scanned_candidates,
    })
}