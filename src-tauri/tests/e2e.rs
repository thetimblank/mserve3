//! L4 real-server end-to-end matrix (gated; never runs in the fast suite).
//!
//! Each case downloads a real provider jar, boots it with a real JVM under a tiny
//! heap, then asserts the lifecycle mserve relies on:
//!   start → port accepts (online) → Server-List-Ping reports a version →
//!   (where applicable) RCON reports TPS → graceful stop exits the process.
//!
//! These are `#[ignore]`d so `cargo test` (the fast gate) skips them. Run with:
//!   cargo test --test e2e -- --ignored            (all)
//!   cargo test --test e2e -- --ignored paper      (one)
//!
//! The cases serialize themselves through a process-wide lock (a real server can't
//! share ports/RAM/console with another), so they are safe to run under the default
//! multi-threaded harness — but `--nocapture` output stays readable regardless.
//!
//! Prerequisites (the `e2e-nightly` workflow provides these):
//!   * a JVM — `MSERVE_E2E_JAVA` (path to java[.exe]) or `JAVA_HOME`. Install a
//!     recent JDK (25+) so the newest provider jars can boot.
//!   * network access to the PaperMC / Mojang APIs.
//!   * for the modded case — `MSERVE_E2E_CUSTOM_JAR` pointing at a Fabric/Forge
//!     server jar (acquiring those needs an installer run, out of scope here).
//!
//! Graceful degradation: a case with an unmet prerequisite (no JVM, no compatible
//! release, a jar the host JVM is too old to run) prints a loud SKIP and passes —
//! *unless* `MSERVE_E2E_REQUIRE=1`, which turns every skip into a hard failure so
//! CI can't go green having booted nothing.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde::de::{MapAccess, Visitor};

// --------------------------------------------------------------------------
// skip / serialization plumbing
// --------------------------------------------------------------------------

/// Prints a loud SKIP and returns from the calling test — or panics when
/// `MSERVE_E2E_REQUIRE=1`, so a CI run that meant to boot servers can't pass by
/// skipping everything.
macro_rules! skip_or_fail {
    ($case:expr, $($arg:tt)*) => {{
        let reason = format!($($arg)*);
        if std::env::var("MSERVE_E2E_REQUIRE").is_ok() {
            panic!("[e2e:{}] REQUIRED but unmet — {}", $case, reason);
        }
        eprintln!("[e2e:{}] SKIP — {}", $case, reason);
        return;
    }};
}

/// Waits for the server to actually answer Server-List-Ping and evaluates to the
/// reported version string, turning a "host JVM too old for this jar" crash into a
/// skip rather than a red failure.
macro_rules! online_or_skip {
    ($case:expr, $server:expr) => {
        match wait_for_online(&mut $server, BOOT_TIMEOUT) {
            Boot::Ready(version) => version,
            Boot::Exited => {
                if $server.java_too_old() {
                    skip_or_fail!(
                        $case,
                        "host JVM is too old to run this jar (needs a newer Java major)"
                    );
                }
                panic!(
                    "[{}] server process exited before coming online (see log above)",
                    $case
                );
            }
            Boot::Timeout => panic!(
                "[{}] server never answered Server-List-Ping within the deadline",
                $case
            ),
        }
    };
}

/// Process-wide serialization: real servers contend for RAM, ports, RCON and the
/// console, so exactly one case runs at a time even under multi-threaded cargo.
/// Recovers from poisoning so one panicking case doesn't wedge the rest.
static SERIAL: Mutex<()> = Mutex::new(());
fn serial_guard() -> std::sync::MutexGuard<'static, ()> {
    SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

// --------------------------------------------------------------------------
// prerequisites & small utilities
// --------------------------------------------------------------------------

/// Resolves a usable `java` executable, or `None` when the host has no JVM
/// configured for the matrix (the caller decides skip vs. fail).
fn java_executable() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("MSERVE_E2E_JAVA") {
        let path = PathBuf::from(explicit);
        if path.exists() {
            return Some(path);
        }
    }
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let exe = if cfg!(windows) { "java.exe" } else { "java" };
        let path = PathBuf::from(home).join("bin").join(exe);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

/// Parses the major version out of `java -version` text (stderr), handling both
/// the modern (`"21.0.3"`) and legacy (`"1.8.0_401"`) version schemes.
fn parse_java_major(text: &str) -> Option<u32> {
    let start = text.find("version \"")? + "version \"".len();
    let rest = &text[start..];
    let end = rest.find('"')?;
    let version = &rest[..end];
    let first: u32 = version.split(['.', '_']).next()?.parse().ok()?;
    if first == 1 {
        // 1.8-style → the real major is the second component.
        version.split('.').nth(1)?.parse().ok()
    } else {
        Some(first)
    }
}

/// Runs `java -version` and returns the host JVM's major version.
fn java_major(java: &Path) -> Option<u32> {
    let output = Command::new(java).arg("-version").output().ok()?;
    // `java -version` writes to stderr on every mainstream JVM.
    parse_java_major(&String::from_utf8_lossy(&output.stderr))
}

fn cache_dir() -> PathBuf {
    // Cached under target/ so reruns reuse downloaded jars.
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/e2e-cache");
    std::fs::create_dir_all(&dir).expect("create e2e cache dir");
    dir
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind ephemeral port")
        .local_addr()
        .unwrap()
        .port()
}

fn http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .user_agent("mserve-e2e/1.0")
        .timeout(Duration::from_secs(120))
        .build()
        .expect("build http client")
}

fn get_json(client: &reqwest::blocking::Client, url: &str) -> serde_json::Value {
    let text = client.get(url).send().expect("GET").text().expect("body");
    serde_json::from_str(&text).expect("parse json")
}

/// Downloads `url` into the cache (skipping if already present) and returns the path.
fn download_cached(client: &reqwest::blocking::Client, url: &str, file_name: &str) -> PathBuf {
    let path = cache_dir().join(file_name);
    if path.exists()
        && std::fs::metadata(&path)
            .map(|m| m.len() > 0)
            .unwrap_or(false)
    {
        return path;
    }
    let bytes = client
        .get(url)
        .send()
        .expect("GET jar")
        .bytes()
        .expect("jar bytes");
    std::fs::write(&path, &bytes).expect("write jar");
    path
}

// --------------------------------------------------------------------------
// jar resolution (mirrors the app's provider sources)
// --------------------------------------------------------------------------

const FILL_BASE: &str = "https://fill.papermc.io/v3";

/// A version string carrying a pre-release marker — mirrors the app's filter so
/// the matrix boots a genuine stable release, not a snapshot.
fn version_is_unstable(version: &str) -> bool {
    let lowered = version.to_lowercase();
    [
        "snapshot",
        "-rc",
        "rc-",
        "-pre",
        "pre-",
        "-exp",
        "experimental",
        "beta",
        "alpha",
    ]
    .iter()
    .any(|marker| lowered.contains(marker))
}

/// Preserves the *document order* of the Fill `versions` object (newest-first).
/// A plain `serde_json::Value` would land the object in a `BTreeMap` and re-sort
/// the keys lexicographically ("1.10" < "1.8"), which is how this matrix used to
/// silently boot an ancient release. This mirrors `providers.rs`.
struct OrderedFamilies(Vec<(String, Vec<String>)>);

impl<'de> Deserialize<'de> for OrderedFamilies {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct FamilyVisitor;
        impl<'de> Visitor<'de> for FamilyVisitor {
            type Value = OrderedFamilies;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a versions object")
            }
            fn visit_map<M>(self, mut access: M) -> Result<Self::Value, M::Error>
            where
                M: MapAccess<'de>,
            {
                let mut families = Vec::new();
                while let Some((family, versions)) = access.next_entry::<String, Vec<String>>()? {
                    families.push((family, versions));
                }
                Ok(OrderedFamilies(families))
            }
        }
        deserializer.deserialize_map(FamilyVisitor)
    }
}

#[derive(Deserialize)]
struct FillProject {
    versions: OrderedFamilies,
}

#[derive(Deserialize)]
struct FillBuild {
    id: u64,
    channel: String,
    downloads: std::collections::BTreeMap<String, FillDownload>,
}

#[derive(Deserialize)]
struct FillDownload {
    url: String,
}

/// Resolves the newest stable `server:default` jar for a Fill project (paper/velocity),
/// honouring document order instead of lexicographic key order.
fn resolve_fill_jar(client: &reqwest::blocking::Client, project: &str) -> (String, String) {
    let text = client
        .get(format!("{FILL_BASE}/projects/{project}"))
        .send()
        .expect("GET fill project")
        .text()
        .expect("fill project body");
    let project_data: FillProject = serde_json::from_str(&text).expect("parse fill project");

    let all_versions = || project_data.versions.0.iter().flat_map(|(_, v)| v.iter());
    let version = all_versions()
        .find(|v| !version_is_unstable(v))
        .or_else(|| all_versions().next())
        .expect("a version")
        .clone();

    let builds_text = client
        .get(format!(
            "{FILL_BASE}/projects/{project}/versions/{version}/builds"
        ))
        .send()
        .expect("GET fill builds")
        .text()
        .expect("fill builds body");
    let builds: Vec<FillBuild> = serde_json::from_str(&builds_text).expect("parse fill builds");

    // Builds are newest-first; prefer the newest STABLE build, else the newest overall.
    let chosen = builds
        .iter()
        .find(|b| b.channel.eq_ignore_ascii_case("STABLE"))
        .or_else(|| builds.first())
        .expect("a build");
    let download = chosen
        .downloads
        .get("server:default")
        .or_else(|| chosen.downloads.values().next())
        .expect("a download");

    (
        download.url.clone(),
        format!("{project}-{version}-{}.jar", chosen.id),
    )
}

/// Resolves the newest vanilla *release* whose required Java major the host JVM can
/// actually run (Mojang publishes `javaVersion.majorVersion` per version). Walking
/// newest-first and stopping at the first compatible release means the matrix always
/// boots a real server instead of crashing on a jar built for a newer JDK.
fn resolve_vanilla_jar(
    client: &reqwest::blocking::Client,
    host_java_major: u32,
) -> Option<(String, String)> {
    let manifest = get_json(
        client,
        "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
    );
    let versions = manifest["versions"].as_array()?;
    for version in versions {
        if version["type"].as_str() != Some("release") {
            continue;
        }
        let id = version["id"].as_str()?;
        let url = version["url"].as_str()?;
        let detail = get_json(client, url);
        let Some(server_url) = detail["downloads"]["server"]["url"].as_str() else {
            continue;
        };
        // 0 = unknown (pre-1.17 versions omit it); treat as always compatible.
        let required = detail["javaVersion"]["majorVersion"].as_u64().unwrap_or(0) as u32;
        if required == 0 || required <= host_java_major {
            return Some((server_url.to_string(), format!("vanilla-{id}.jar")));
        }
    }
    None
}

// --------------------------------------------------------------------------
// server directory + process control
// --------------------------------------------------------------------------

struct RunningServer {
    child: Child,
    dir: PathBuf,
    game_port: u16,
    rcon_port: u16,
    rcon_password: String,
    logs: Arc<Mutex<String>>,
}

impl RunningServer {
    /// Heuristic: did the server refuse to boot because the host JVM is too old for
    /// this jar? Covers both the raw JVM signal (`UnsupportedClassVersionError`) and
    /// providers like Paper that run their own pre-flight Java check and exit with a
    /// friendly message instead of letting the class loader throw.
    fn java_too_old(&self) -> bool {
        self.logs
            .lock()
            .map(|logs| {
                let lower = logs.to_ascii_lowercase();
                lower.contains("unsupportedclassversionerror")
                    || lower.contains("class file version")
                    || lower.contains("requires running the server with java")
                    || (lower.contains("requires")
                        && lower.contains("java")
                        && (lower.contains("or above") || lower.contains("or newer")))
            })
            .unwrap_or(false)
    }
}

impl Drop for RunningServer {
    fn drop(&mut self) {
        // Never leave a stray JVM behind, even on a failed assertion.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Drains a child stream into a shared log buffer on its own thread, echoing each
/// line with a `[case]` prefix so `--nocapture` stays readable and the server's
/// stdout never bleeds into (or reads from) the test's console.
fn spawn_drain<R: Read + Send + 'static>(reader: R, logs: Arc<Mutex<String>>, case: String) {
    std::thread::spawn(move || {
        let mut buf = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match buf.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    eprint!("[{case}] {line}");
                    if let Ok(mut logs) = logs.lock() {
                        logs.push_str(&line);
                    }
                }
            }
        }
    });
}

/// Writes eula + server.properties (with loopback RCON, offline mode, the chosen
/// ports) and spawns the JVM. Mirrors how mserve provisions a server. stdin is
/// null and stdout/stderr are captured, so the server can never touch the console.
fn boot_server(java: &Path, jar: &Path, case: &str) -> RunningServer {
    let dir = cache_dir().join(format!("run-{case}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create run dir");

    let game_port = free_port();
    let rcon_port = free_port();
    let rcon_password = "e2e-secret".to_string();

    std::fs::write(dir.join("eula.txt"), "eula=true\n").expect("write eula");
    std::fs::write(
        dir.join("server.properties"),
        format!(
            "server-port={game_port}\n\
             online-mode=false\n\
             enable-rcon=true\n\
             rcon.port={rcon_port}\n\
             rcon.password={rcon_password}\n\
             max-players=5\n\
             spawn-protection=0\n"
        ),
    )
    .expect("write server.properties");

    // Velocity ignores server.properties — it binds the port from velocity.toml
    // (defaulting to 25577). Pin it to our ephemeral port so the online probe and
    // SLP target the address the proxy actually listens on. Non-proxy servers
    // simply ignore this file. Velocity migrates a stale config-version in place,
    // preserving `bind`, so this stays correct across Velocity releases.
    std::fs::write(
        dir.join("velocity.toml"),
        format!(
            "config-version = \"2.7\"\n\
             bind = \"0.0.0.0:{game_port}\"\n\
             motd = \"e2e\"\n\
             show-max-players = 5\n\
             online-mode = false\n\
             player-info-forwarding-mode = \"none\"\n"
        ),
    )
    .expect("write velocity.toml");

    let mut child = Command::new(java)
        .current_dir(&dir)
        .args(["-Xmx1G", "-Xms512M", "-jar"])
        .arg(jar)
        .arg("nogui")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn jvm");

    let logs = Arc::new(Mutex::new(String::new()));
    if let Some(stdout) = child.stdout.take() {
        spawn_drain(stdout, Arc::clone(&logs), case.to_string());
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_drain(stderr, Arc::clone(&logs), case.to_string());
    }

    RunningServer {
        child,
        dir,
        game_port,
        rcon_port,
        rcon_password,
        logs,
    }
}

/// The three ways a boot can end: the server answered Server-List-Ping (truly
/// serving, not merely a bound socket), the process died first, or the deadline
/// passed.
enum Boot {
    Ready(String),
    Exited,
    Timeout,
}

/// Blocks until the server actually answers Server-List-Ping, the child exits, or
/// the deadline passes. A bare TCP accept is *not* enough — Minecraft binds its
/// listen socket during world-gen, well before it will answer a status ping, so a
/// plain connect probe reports "online" far too early. Polling the real protocol
/// is the authoritative readiness signal (and still catches a fast class-version
/// crash within a couple of seconds via `try_wait`).
fn wait_for_online(server: &mut RunningServer, timeout: Duration) -> Boot {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(version) = slp_version(server.game_port) {
            return Boot::Ready(version);
        }
        if let Ok(Some(_)) = server.child.try_wait() {
            return Boot::Exited;
        }
        if Instant::now() >= deadline {
            return Boot::Timeout;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

/// Polls the provider's TPS command(s) over RCON until one yields a numeric reading,
/// the child exits, or the deadline passes. RCON only comes up once the server is
/// fully started, so — like readiness — this needs to retry rather than assume.
fn wait_for_tps(server: &mut RunningServer, commands: &[&str], timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        let got = commands.iter().any(|cmd| {
            rcon_command(server.rcon_port, &server.rcon_password, cmd)
                .map(|r| r.chars().any(|c| c.is_ascii_digit()))
                .unwrap_or(false)
        });
        if got {
            return true;
        }
        if let Ok(Some(_)) = server.child.try_wait() {
            return false;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

// --------------------------------------------------------------------------
// minimal SLP + RCON clients (the matrix asserts the real protocol replies)
// --------------------------------------------------------------------------

fn encode_varint(mut value: u32) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if value == 0 {
            break;
        }
    }
    out
}

fn read_varint(stream: &mut TcpStream) -> Option<i32> {
    let (mut result, mut shift) = (0i32, 0);
    loop {
        if shift >= 35 {
            return None;
        }
        let mut b = [0u8; 1];
        stream.read_exact(&mut b).ok()?;
        result |= ((b[0] & 0x7F) as i32) << shift;
        if b[0] & 0x80 == 0 {
            return Some(result);
        }
        shift += 7;
    }
}

/// Returns the version string reported by Server List Ping, if any.
fn slp_version(port: u16) -> Option<String> {
    let mut stream = TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}").parse().unwrap(),
        Duration::from_secs(2),
    )
    .ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok()?;

    let host = "127.0.0.1";
    let mut handshake = vec![0x00];
    handshake.extend_from_slice(&encode_varint(754));
    handshake.extend_from_slice(&encode_varint(host.len() as u32));
    handshake.extend_from_slice(host.as_bytes());
    handshake.extend_from_slice(&port.to_be_bytes());
    handshake.extend_from_slice(&encode_varint(1));
    let mut packet = encode_varint(handshake.len() as u32);
    packet.extend_from_slice(&handshake);
    stream.write_all(&packet).ok()?;

    let mut request = encode_varint(1);
    request.push(0x00);
    stream.write_all(&request).ok()?;

    let _len = read_varint(&mut stream)?;
    let _packet_id = read_varint(&mut stream)?;
    let json_len = read_varint(&mut stream)? as usize;
    let mut json = vec![0u8; json_len];
    stream.read_exact(&mut json).ok()?;
    let parsed: serde_json::Value = serde_json::from_slice(&json).ok()?;
    parsed["version"]["name"].as_str().map(|s| s.to_string())
}

/// Runs one RCON command and returns the response body.
fn rcon_command(port: u16, password: &str, command: &str) -> Option<String> {
    let mut stream = TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}").parse().unwrap(),
        Duration::from_secs(2),
    )
    .ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok()?;

    let send = |stream: &mut TcpStream, id: i32, kind: i32, body: &str| -> Option<()> {
        let body_bytes = body.as_bytes();
        let length = (4 + 4 + body_bytes.len() + 2) as i32;
        let mut packet = Vec::new();
        packet.extend_from_slice(&length.to_le_bytes());
        packet.extend_from_slice(&id.to_le_bytes());
        packet.extend_from_slice(&kind.to_le_bytes());
        packet.extend_from_slice(body_bytes);
        packet.push(0);
        packet.push(0);
        stream.write_all(&packet).ok()
    };
    let recv = |stream: &mut TcpStream| -> Option<(i32, String)> {
        let mut len_buf = [0u8; 4];
        stream.read_exact(&mut len_buf).ok()?;
        let len = i32::from_le_bytes(len_buf) as usize;
        let mut buf = vec![0u8; len];
        stream.read_exact(&mut buf).ok()?;
        let id = i32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
        let body = String::from_utf8_lossy(&buf[8..buf.len().saturating_sub(2)]).to_string();
        Some((id, body))
    };

    send(&mut stream, 1, 3, password)?; // auth
    let (auth_id, _) = recv(&mut stream)?;
    if auth_id == -1 {
        return None; // rejected
    }
    send(&mut stream, 2, 2, command)?; // exec
    let (_, body) = recv(&mut stream)?;
    Some(body)
}

/// Sends `stop` over RCON and waits for the process to exit, returning whether it
/// stopped gracefully within the deadline.
fn graceful_stop(server: &mut RunningServer, timeout: Duration) -> bool {
    let _ = rcon_command(server.rcon_port, &server.rcon_password, "stop");
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match server.child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => std::thread::sleep(Duration::from_millis(500)),
            Err(_) => return false,
        }
    }
    false
}

const BOOT_TIMEOUT: Duration = Duration::from_secs(180);
const TPS_TIMEOUT: Duration = Duration::from_secs(90);
const STOP_TIMEOUT: Duration = Duration::from_secs(45);

/// Shared assertions for a server that should report TPS over RCON (paper/vanilla/modded).
fn assert_boots_with_tps(case: &str, jar: PathBuf, java: PathBuf, tps_commands: &[&str]) {
    let mut server = boot_server(&java, &jar, case);
    let version = online_or_skip!(case, server);
    eprintln!(
        "[e2e:{case}] online, version = {version:?} (dir: {})",
        server.dir.display()
    );

    // At least one of the provider's TPS commands should eventually yield a numeric
    // reading (RCON comes up a beat after the status listener).
    assert!(
        wait_for_tps(&mut server, tps_commands, TPS_TIMEOUT),
        "[{case}] no TPS reading from RCON {tps_commands:?}"
    );

    assert!(
        graceful_stop(&mut server, STOP_TIMEOUT),
        "[{case}] did not stop gracefully"
    );
}

// --------------------------------------------------------------------------
// the matrix
// --------------------------------------------------------------------------

#[test]
#[ignore = "real-server E2E; run with --ignored"]
fn paper_boots_online_and_reports_tps() {
    let _serial = serial_guard();
    let Some(java) = java_executable() else {
        skip_or_fail!("paper", "no JVM (set MSERVE_E2E_JAVA or JAVA_HOME)");
    };
    let client = http_client();
    let (url, name) = resolve_fill_jar(&client, "paper");
    let jar = download_cached(&client, &url, &name);
    // Paper answers the `tps` command.
    assert_boots_with_tps("paper", jar, java, &["tps"]);
}

#[test]
#[ignore = "real-server E2E; run with --ignored"]
fn vanilla_boots_online_and_reports_via_tick_query() {
    let _serial = serial_guard();
    let Some(java) = java_executable() else {
        skip_or_fail!("vanilla", "no JVM (set MSERVE_E2E_JAVA or JAVA_HOME)");
    };
    // Unknown host major → assume newest; a class-version crash then skips cleanly.
    let host_major = java_major(&java).unwrap_or(u32::MAX);
    let client = http_client();
    let Some((url, name)) = resolve_vanilla_jar(&client, host_major) else {
        skip_or_fail!(
            "vanilla",
            "no release compatible with host Java {host_major}"
        );
    };
    let jar = download_cached(&client, &url, &name);
    // Modern vanilla answers `tick query`; older has neither — try both, the
    // assertion tolerates whichever the resolved version supports.
    assert_boots_with_tps("vanilla", jar, java, &["tick query", "tps"]);
}

#[test]
#[ignore = "real-server E2E; run with --ignored"]
fn velocity_proxy_answers_slp_without_tps() {
    let _serial = serial_guard();
    let Some(java) = java_executable() else {
        skip_or_fail!("velocity", "no JVM (set MSERVE_E2E_JAVA or JAVA_HOME)");
    };
    let client = http_client();
    let (url, name) = resolve_fill_jar(&client, "velocity");
    let jar = download_cached(&client, &url, &name);

    let mut server = boot_server(&java, &jar, "velocity");
    // A proxy answers SLP (so telemetry online/version works) but exposes no TPS.
    // Reaching Ready here *is* the SLP assertion.
    let version = online_or_skip!("velocity", server);
    eprintln!(
        "[e2e:velocity] online, version = {version:?} (dir: {})",
        server.dir.display()
    );

    // Velocity is shut down via its console `end`/`shutdown`; force-kill is the
    // reliable cross-version stop here (mserve does the same after the grace).
    let _ = server.child.kill();
    assert!(server.child.wait().is_ok());
}

#[test]
#[ignore = "real-server E2E; run with --ignored"]
fn modded_custom_jar_boots_online() {
    let _serial = serial_guard();
    let Some(java) = java_executable() else {
        skip_or_fail!("modded", "no JVM (set MSERVE_E2E_JAVA or JAVA_HOME)");
    };
    let Ok(custom) = std::env::var("MSERVE_E2E_CUSTOM_JAR") else {
        // A modded jar can't be fetched unattended (installer run required), so this
        // case is *optionally* provided — an always-skip, never a REQUIRE failure.
        eprintln!("[e2e:modded] SKIP — set MSERVE_E2E_CUSTOM_JAR to a Fabric/Forge server jar.");
        return;
    };
    let jar = PathBuf::from(custom);
    assert!(
        jar.exists(),
        "[modded] MSERVE_E2E_CUSTOM_JAR does not exist: {}",
        jar.display()
    );

    let mut server = boot_server(&java, &jar, "modded");
    let version = online_or_skip!("modded", server);
    eprintln!(
        "[e2e:modded] online, version = {version:?} (dir: {})",
        server.dir.display()
    );
    let _ = graceful_stop(&mut server, STOP_TIMEOUT);
}

/// A crash (bad jar / bad flags) must surface as a non-zero exit, which the
/// supervisor maps to `crashed`. Offline but JVM-dependent, so it stays in the
/// gated matrix to keep the fast `cargo test` hermetic.
#[test]
#[ignore = "real-server E2E; run with --ignored"]
fn bogus_jar_exits_nonzero() {
    let _serial = serial_guard();
    let Some(java) = java_executable() else {
        skip_or_fail!("crash", "no JVM (set MSERVE_E2E_JAVA or JAVA_HOME)");
    };
    let dir = cache_dir().join(format!("run-crash-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let bogus = dir.join("not-a-real.jar");
    std::fs::write(&bogus, b"this is not a jar").unwrap();

    let status = Command::new(java)
        .current_dir(&dir)
        .args(["-jar"])
        .arg(&bogus)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("spawn jvm");
    assert!(!status.success(), "a bogus jar should exit non-zero");
}

// --------------------------------------------------------------------------
// unit coverage for the resolver/parse helpers (run in the fast suite)
// --------------------------------------------------------------------------

#[cfg(test)]
mod helper_tests {
    use super::*;

    #[test]
    fn fill_versions_keep_document_order_not_lexicographic() {
        // The exact shape that used to mis-sort: "1.10" would beat "1.8" under a
        // BTreeMap. Document order must win, so the newest family stays first.
        let json = r#"{"versions":{"1.21":["1.21.4","1.21.3"],"1.20":["1.20.6"],"1.8":["1.8.8"]}}"#;
        let project: FillProject = serde_json::from_str(json).unwrap();
        let first = project.versions.0.first().unwrap();
        assert_eq!(first.0, "1.21");
        assert_eq!(first.1[0], "1.21.4");
    }

    #[test]
    fn java_major_parses_modern_and_legacy() {
        assert_eq!(
            parse_java_major("openjdk version \"21.0.3\" 2024-04-16"),
            Some(21)
        );
        assert_eq!(parse_java_major("java version \"25\" 2025-09-16"), Some(25));
        assert_eq!(parse_java_major("java version \"1.8.0_401\""), Some(8));
        assert_eq!(parse_java_major("no version here"), None);
    }

    #[test]
    fn unstable_markers_are_filtered() {
        assert!(version_is_unstable("1.21-pre1"));
        assert!(version_is_unstable("23w31a-snapshot"));
        assert!(!version_is_unstable("1.21.4"));
    }
}
