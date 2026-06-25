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
//! Prerequisites (the `e2e-nightly` workflow provides these):
//!   * a JVM — `MSERVE_E2E_JAVA` (path to java[.exe]) or `JAVA_HOME`.
//!   * network access to the PaperMC / Mojang APIs.
//!   * for the modded case — `MSERVE_E2E_CUSTOM_JAR` pointing at a Fabric/Forge
//!     server jar (acquiring those needs an installer run, out of scope here).
//!
//! A case with an unmet prerequisite prints a SKIP line and passes, so the matrix
//! degrades gracefully on a machine that can't satisfy every provider.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

// --------------------------------------------------------------------------
// prerequisites & small utilities
// --------------------------------------------------------------------------

/// Resolves a usable `java` executable, or `None` (with a SKIP message) when the
/// host has no JVM configured for the matrix.
fn java_executable(case: &str) -> Option<PathBuf> {
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
    eprintln!("[e2e:{case}] SKIP — no JVM (set MSERVE_E2E_JAVA or JAVA_HOME).");
    None
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

/// Resolves the newest stable `server:default` jar for a Fill project (paper/velocity).
fn resolve_fill_jar(client: &reqwest::blocking::Client, project: &str) -> (String, String) {
    let project_json = get_json(client, &format!("{FILL_BASE}/projects/{project}"));
    let versions = project_json["versions"]
        .as_object()
        .expect("versions object");
    let newest_family = versions.keys().next().expect("a version family");
    let newest_version = versions[newest_family][0]
        .as_str()
        .expect("a version string")
        .to_string();

    let builds = get_json(
        client,
        &format!("{FILL_BASE}/projects/{project}/versions/{newest_version}/builds"),
    );
    let download = &builds[0]["downloads"]["server:default"];
    let url = download["url"].as_str().expect("download url").to_string();
    (url, format!("{project}-{newest_version}.jar"))
}

/// Resolves the latest vanilla release server jar from the Mojang manifest.
fn resolve_vanilla_jar(client: &reqwest::blocking::Client) -> (String, String) {
    let manifest = get_json(
        client,
        "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
    );
    let latest = manifest["latest"]["release"]
        .as_str()
        .expect("latest release");
    let version_url = manifest["versions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"].as_str() == Some(latest))
        .and_then(|v| v["url"].as_str())
        .expect("version url")
        .to_string();
    let detail = get_json(client, &version_url);
    let url = detail["downloads"]["server"]["url"]
        .as_str()
        .expect("server download url")
        .to_string();
    (url, format!("vanilla-{latest}.jar"))
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
}

impl Drop for RunningServer {
    fn drop(&mut self) {
        // Never leave a stray JVM behind, even on a failed assertion.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Writes eula + server.properties (with loopback RCON, offline mode, the chosen
/// ports) and spawns the JVM. Mirrors how mserve provisions a server.
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

    let child = Command::new(java)
        .current_dir(&dir)
        .args(["-Xmx1G", "-Xms512M", "-jar"])
        .arg(jar)
        .arg("nogui")
        .spawn()
        .expect("spawn jvm");

    RunningServer {
        child,
        dir,
        game_port,
        rcon_port,
        rcon_password,
    }
}

/// Blocks until the game port accepts a connection or the deadline passes.
fn wait_until_online(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().unwrap(),
            Duration::from_millis(500),
        )
        .is_ok()
        {
            return true;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
    false
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
const STOP_TIMEOUT: Duration = Duration::from_secs(45);

/// Shared assertions for a server that should report TPS over RCON (paper/vanilla/modded).
fn assert_boots_with_tps(case: &str, jar: PathBuf, java: PathBuf, tps_commands: &[&str]) {
    let mut server = boot_server(&java, &jar, case);
    assert!(
        wait_until_online(server.game_port, BOOT_TIMEOUT),
        "[{case}] server never bound its port"
    );

    let version = slp_version(server.game_port);
    assert!(version.is_some(), "[{case}] SLP returned no version");
    eprintln!(
        "[e2e:{case}] online, version = {version:?} (dir: {})",
        server.dir.display()
    );

    // At least one of the provider's TPS commands should yield a numeric reading.
    let got_tps = tps_commands.iter().any(|cmd| {
        rcon_command(server.rcon_port, &server.rcon_password, cmd)
            .map(|r| r.chars().any(|c| c.is_ascii_digit()))
            .unwrap_or(false)
    });
    assert!(
        got_tps,
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
    let Some(java) = java_executable("paper") else {
        return;
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
    let Some(java) = java_executable("vanilla") else {
        return;
    };
    let client = http_client();
    let (url, name) = resolve_vanilla_jar(&client);
    let jar = download_cached(&client, &url, &name);
    // Modern vanilla answers `tick query`; older has neither — try both, the
    // assertion tolerates whichever the resolved version supports.
    assert_boots_with_tps("vanilla", jar, java, &["tick query", "tps"]);
}

#[test]
#[ignore = "real-server E2E; run with --ignored"]
fn velocity_proxy_answers_slp_without_tps() {
    let Some(java) = java_executable("velocity") else {
        return;
    };
    let client = http_client();
    let (url, name) = resolve_fill_jar(&client, "velocity");
    let jar = download_cached(&client, &url, &name);

    let mut server = boot_server(&java, &jar, "velocity");
    assert!(
        wait_until_online(server.game_port, BOOT_TIMEOUT),
        "[velocity] proxy never bound its port"
    );
    // A proxy answers SLP (so telemetry online/version works) but exposes no TPS.
    assert!(
        slp_version(server.game_port).is_some(),
        "[velocity] SLP returned no version"
    );
    eprintln!("[e2e:velocity] online (dir: {})", server.dir.display());

    // Velocity is shut down via its console `end`/`shutdown`; force-kill is the
    // reliable cross-version stop here (mserve does the same after the grace).
    let _ = server.child.kill();
    assert!(server.child.wait().is_ok());
}

#[test]
#[ignore = "real-server E2E; run with --ignored"]
fn modded_custom_jar_boots_online() {
    let Some(java) = java_executable("modded") else {
        return;
    };
    let Ok(custom) = std::env::var("MSERVE_E2E_CUSTOM_JAR") else {
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
    assert!(
        wait_until_online(server.game_port, BOOT_TIMEOUT),
        "[modded] custom jar never bound its port"
    );
    assert!(
        slp_version(server.game_port).is_some(),
        "[modded] SLP returned no version"
    );
    eprintln!("[e2e:modded] online (dir: {})", server.dir.display());
    let _ = graceful_stop(&mut server, STOP_TIMEOUT);
}

/// A crash (bad jar / bad flags) must surface as a non-zero exit, which the
/// supervisor maps to `crashed`. Offline but JVM-dependent, so it stays in the
/// gated matrix to keep the fast `cargo test` hermetic.
#[test]
#[ignore = "real-server E2E; run with --ignored"]
fn bogus_jar_exits_nonzero() {
    let Some(java) = java_executable("crash") else {
        return;
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
        .status()
        .expect("spawn jvm");
    assert!(!status.success(), "a bogus jar should exit non-zero");
}
