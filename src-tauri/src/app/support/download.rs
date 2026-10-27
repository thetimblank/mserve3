//! Shared HTTP plumbing for every download and remote lookup: one client
//! builder, a per-user scratch directory, and a streaming download that verifies
//! its checksum and never leaves a partial file behind.

use sha1::Sha1;
use sha2::{Digest, Sha256, Sha512};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Identifies mserve to the APIs it calls (Modrinth asks for a contact pointer).
const USER_AGENT: &str = concat!(
    "mserve/",
    env!("CARGO_PKG_VERSION"),
    " (github.com/thetimblank/mserve3)"
);

/// Blocking HTTP client with the mserve User-Agent and a whole-request timeout.
pub(in crate::app) fn http_client(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|err| err.to_string())
}

/// Per-user scratch root for downloads and caches (`<root>/<name>`, created on
/// demand). Linux's `/tmp` is shared by every account, so a predictable
/// `/tmp/mserve` could be pre-created or symlinked by another user; there the
/// user's cache dir is used instead. Windows and macOS temp dirs are per-user.
pub(in crate::app) fn scratch_dir(name: &str) -> Result<PathBuf, String> {
    #[cfg(target_os = "linux")]
    let root = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or_else(|| super::home_dir().join(".cache"))
        .join("mserve");
    #[cfg(not(target_os = "linux"))]
    let root = std::env::temp_dir().join("mserve");

    let dir = root.join(name);
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

/// A hash the downloaded bytes must match (hex, case-insensitive).
pub(in crate::app) enum Checksum {
    Sha1(String),
    Sha256(String),
    Sha512(String),
}

impl Checksum {
    /// Builds a checksum from an optional hex string, ignoring blanks.
    pub(in crate::app) fn from_hex(make: fn(String) -> Self, value: Option<&str>) -> Option<Self> {
        value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| make(value.to_string()))
    }
}

enum Hasher {
    Sha1(Sha1),
    Sha256(Sha256),
    Sha512(Sha512),
}

impl Hasher {
    fn for_checksum(checksum: &Checksum) -> (Self, &str) {
        match checksum {
            Checksum::Sha1(hex) => (Self::Sha1(Sha1::new()), hex),
            Checksum::Sha256(hex) => (Self::Sha256(Sha256::new()), hex),
            Checksum::Sha512(hex) => (Self::Sha512(Sha512::new()), hex),
        }
    }

    fn update(&mut self, bytes: &[u8]) {
        match self {
            Self::Sha1(hasher) => hasher.update(bytes),
            Self::Sha256(hasher) => hasher.update(bytes),
            Self::Sha512(hasher) => hasher.update(bytes),
        }
    }

    fn finalize_hex(self) -> String {
        match self {
            Self::Sha1(hasher) => format!("{:x}", hasher.finalize()),
            Self::Sha256(hasher) => format!("{:x}", hasher.finalize()),
            Self::Sha512(hasher) => format!("{:x}", hasher.finalize()),
        }
    }
}

/// Streams `url` into `destination` (creating its parent), reporting
/// `(downloaded, total)` after each chunk. Fails on a non-success status, an
/// empty body, or a checksum mismatch, and removes the partial file whenever it
/// fails. Returns the number of bytes written.
pub(in crate::app) fn download_to_file(
    client: &reqwest::blocking::Client,
    url: &str,
    destination: &Path,
    checksum: Option<&Checksum>,
    on_chunk: impl FnMut(u64, Option<u64>),
) -> Result<u64, String> {
    let result = stream_to_file(client, url, destination, checksum, on_chunk);
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

fn stream_to_file(
    client: &reqwest::blocking::Client,
    url: &str,
    destination: &Path,
    checksum: Option<&Checksum>,
    mut on_chunk: impl FnMut(u64, Option<u64>),
) -> Result<u64, String> {
    let mut response = client.get(url).send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Download of {url} failed with HTTP status {}.",
            response.status().as_u16()
        ));
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let total = response.content_length();
    let mut file = fs::File::create(destination).map_err(|err| err.to_string())?;
    let mut hasher = checksum.map(Hasher::for_checksum);
    let mut downloaded: u64 = 0;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = response.read(&mut buffer).map_err(|err| err.to_string())?;
        if read == 0 {
            break;
        }
        if let Some((hasher, _)) = hasher.as_mut() {
            hasher.update(&buffer[..read]);
        }
        file.write_all(&buffer[..read])
            .map_err(|err| err.to_string())?;
        downloaded = downloaded.saturating_add(read as u64);
        on_chunk(downloaded, total);
    }
    file.flush().map_err(|err| err.to_string())?;

    if downloaded == 0 {
        return Err(format!("The download from {url} was empty."));
    }

    if let Some((hasher, expected)) = hasher
        && !hasher.finalize_hex().eq_ignore_ascii_case(expected)
    {
        return Err(format!(
            "The download from {url} failed integrity verification."
        ));
    }

    Ok(downloaded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checksum_from_hex_ignores_blank_values() {
        assert!(Checksum::from_hex(Checksum::Sha256, None).is_none());
        assert!(Checksum::from_hex(Checksum::Sha256, Some("  ")).is_none());
        assert!(matches!(
            Checksum::from_hex(Checksum::Sha256, Some(" ab ")),
            Some(Checksum::Sha256(hex)) if hex == "ab"
        ));
    }

    #[test]
    fn hashers_produce_lowercase_hex() {
        let (mut hasher, _) = Hasher::for_checksum(&Checksum::Sha1(String::new()));
        hasher.update(b"abc");
        assert_eq!(
            hasher.finalize_hex(),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );

        let (mut hasher, _) = Hasher::for_checksum(&Checksum::Sha256(String::new()));
        hasher.update(b"abc");
        assert_eq!(
            hasher.finalize_hex(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn scratch_dir_is_created_under_an_mserve_root() {
        let dir = scratch_dir("unit-test-scratch").unwrap();
        assert!(dir.is_dir());
        assert!(
            dir.parent()
                .is_some_and(|parent| parent.ends_with("mserve"))
        );
        let _ = fs::remove_dir(dir);
    }
}
