use super::super::support::no_window_command;
use super::super::*;
use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

#[derive(Clone)]
struct JavaCandidate {
    path: PathBuf,
    source: &'static str,
}

const fn java_executable_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "java.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "java"
    }
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
    dunce::canonicalize(&path).unwrap_or(path)
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

/// Looks for `<dir>/bin/java(.exe)` and, up to `depth` directory levels below
/// `dir`, the same under each nested folder. Replaces the hand-rolled traversal
/// that used to be duplicated for the common install-dir scan.
fn push_java_under(
    dir: &Path,
    depth: u32,
    candidates: &mut Vec<JavaCandidate>,
    seen: &mut HashSet<String>,
    source: &'static str,
) {
    if !dir.is_dir() {
        return;
    }

    push_candidate(
        candidates,
        seen,
        dir.join("bin").join(java_executable_name()),
        source,
    );

    if depth == 0 {
        return;
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            push_java_under(&path, depth - 1, candidates, seen, source);
        }
    }
}

/// Root directory where mserve stores Java runtimes it downloaded itself.
/// Shared with the download command so detection always surfaces them.
pub(in crate::app) fn managed_java_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|dir| dir.join("java"))
}

fn collect_managed_candidates(
    app: &tauri::AppHandle,
    candidates: &mut Vec<JavaCandidate>,
    seen: &mut HashSet<String>,
) {
    let Some(root) = managed_java_root(app) else {
        return;
    };

    if !root.is_dir() {
        return;
    }

    // temurin-<major>/<extracted-root>/bin/java(.exe) — scan two levels deep so
    // the vendor's nested archive folder is picked up regardless of its name.
    let Ok(entries) = std::fs::read_dir(&root) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            push_java_under(&path, 2, candidates, seen, "managed");
        }
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

    push_candidate(
        candidates,
        seen,
        PathBuf::from(trimmed)
            .join("bin")
            .join(java_executable_name()),
        "java_home",
    );
}

fn collect_path_candidates(
    candidates: &mut Vec<JavaCandidate>,
    seen: &mut HashSet<String>,
    errors: &mut Vec<String>,
) {
    #[cfg(target_os = "windows")]
    let output = no_window_command("where").arg("java").output();

    #[cfg(not(target_os = "windows"))]
    let output = no_window_command("which").args(["-a", "java"]).output();

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

    let mut base_seen = HashSet::new();

    for base_dir in base_dirs {
        if !base_seen.insert(candidate_key(&base_dir)) {
            continue;
        }

        for vendor in VENDOR_ROOTS {
            // <ProgramFiles>/<vendor>/bin/java.exe and two levels of nested JDK
            // folders below it (e.g. .../Eclipse Adoptium/jdk-21.../bin/java.exe).
            push_java_under(&base_dir.join(vendor), 1, candidates, seen, "common_install_dir");
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

/// Fast path: read the `release` file shipped in every modern JDK/JRE instead of
/// spawning `java -version`. The file lives at `<home>/release` where `<home>`
/// is the parent of the `bin` directory and contains `JAVA_VERSION="…"`.
fn read_release_version(java_executable: &Path) -> Option<String> {
    let home = java_executable.parent()?.parent()?;
    let content = std::fs::read_to_string(home.join("release")).ok()?;

    for line in content.lines() {
        if let Some(rest) = line.trim().strip_prefix("JAVA_VERSION=") {
            let value = rest.trim().trim_matches('"').trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }

    None
}

fn version_via_command(candidate: &JavaCandidate) -> Result<String, String> {
    let output = no_window_command(&candidate.path)
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

    extract_java_version(&combined_output).ok_or_else(|| {
        format!(
            "{} ({}) returned version output that could not be parsed.",
            candidate.path.to_string_lossy(),
            candidate.source
        )
    })
}

fn inspect_java_candidate(candidate: &JavaCandidate) -> Result<JavaRuntimeInfo, String> {
    let version = match read_release_version(&candidate.path) {
        Some(value) if parse_java_major(&value).is_some() => value,
        _ => version_via_command(candidate)?,
    };

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
        source: candidate.source.to_string(),
    })
}

/// Inspects every candidate. Used by both detection and the download command so
/// a freshly extracted runtime is described the same way as a detected one.
pub(in crate::app) fn inspect_java_executable(
    path: &Path,
    source: &'static str,
) -> Result<JavaRuntimeInfo, String> {
    inspect_java_candidate(&JavaCandidate {
        path: path.to_path_buf(),
        source,
    })
}

#[tauri::command]
pub(in crate::app) fn detect_java_runtimes(
    app: tauri::AppHandle,
) -> Result<JavaRuntimeDetectionResult, String> {
    let mut candidates = Vec::new();
    let mut seen_candidates = HashSet::new();
    let mut errors = Vec::new();

    collect_managed_candidates(&app, &mut candidates, &mut seen_candidates);
    collect_java_home_candidate(&mut candidates, &mut seen_candidates);
    collect_path_candidates(&mut candidates, &mut seen_candidates, &mut errors);
    collect_windows_common_candidates(&mut candidates, &mut seen_candidates);

    let scanned_candidates = candidates.len();

    // Inspect candidates concurrently — each one may spawn `java -version`, which
    // is slow when several runtimes are installed.
    let runtimes = Mutex::new(Vec::new());
    let errors = Mutex::new(errors);

    std::thread::scope(|scope| {
        for candidate in &candidates {
            scope.spawn(|| match inspect_java_candidate(candidate) {
                Ok(runtime) => runtimes.lock().unwrap().push(runtime),
                Err(err) => errors.lock().unwrap().push(err),
            });
        }
    });

    let mut runtimes = runtimes.into_inner().unwrap();
    let errors = errors.into_inner().unwrap();

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
