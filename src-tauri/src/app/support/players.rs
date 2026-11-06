//! Online player list for the beginner players panel, read over RCON: `list`
//! for who is online, plus the `keepInventory` game rule so the panel's toggle
//! shows the real value. `ops.json` / `whitelist.json` mark who is already an
//! operator or whitelisted, so the panel only offers the actions that apply.

use super::super::RconConfig;
use super::rcon::RconClient;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

const RCON_TIMEOUT: Duration = Duration::from_millis(1500);

/// `list uuids` prints account names (plain `list` prints display names, which
/// plugins and teams decorate). `minecraft:list uuids` skips a plugin (such as
/// EssentialsX) that replaces `list` on Bukkit-based servers; plain `list` is
/// the last resort for servers that know neither.
const LIST_COMMANDS: &[&str] = &["list uuids", "minecraft:list uuids", "list"];

/// The game rule was renamed to snake_case in Minecraft 1.21.11.
const KEEP_INVENTORY_RULES: &[&str] = &["keepInventory", "keep_inventory"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::app) struct OnlinePlayer {
    pub name: String,
    pub is_op: bool,
    pub is_whitelisted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::app) struct OnlinePlayers {
    pub online: u32,
    pub max: u32,
    pub players: Vec<OnlinePlayer>,
    /// `None` when the server didn't answer the game rule query.
    pub keep_inventory: Option<bool>,
    /// The rule name the server understood (`keepInventory` or
    /// `keep_inventory`), to build the matching `gamerule` command.
    pub keep_inventory_rule: Option<String>,
}

/// The parsed reply of a `list` command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::app) struct PlayerList {
    pub online: u32,
    pub max: u32,
    pub names: Vec<String>,
}

/// True for a name Minecraft accepts as a Java player name.
pub(in crate::app) fn is_valid_player_name(name: &str) -> bool {
    (1..=16).contains(&name.len())
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

/// Removes `§x` formatting codes (servers and plugins color their replies).
fn strip_formatting(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(ch) = chars.next() {
        if ch == '§' {
            chars.next();
        } else {
            out.push(ch);
        }
    }
    out
}

/// Reads the leading run of ASCII digits, returning it and the rest.
fn take_number(text: &str) -> Option<(u32, &str)> {
    let end = text
        .find(|ch: char| !ch.is_ascii_digit())
        .unwrap_or(text.len());
    let value = text[..end].parse().ok()?;
    Some((value, &text[end..]))
}

/// Parses a `list` reply. Understands the modern form ("There are 2 of a max of
/// 20 players online: Steve, Alex"), the legacy one ("There are 2/20 players
/// online:" with names on the same or the next line), and EssentialsX-style
/// group lines ("default: Steve, Alex"). A `list uuids` entry ("Steve
/// (069a79f4-…)") keeps only the name. Invalid names are dropped.
pub(in crate::app) fn parse_player_list(response: &str) -> Option<PlayerList> {
    let text = strip_formatting(response);
    let lower = text.to_ascii_lowercase();
    let start = lower.find("there are ")? + "there are ".len();
    let header_end = lower[start..].find("players online")? + start;

    let (online, rest) = take_number(&text[start..header_end])?;
    let max_start = rest.find(|ch: char| ch.is_ascii_digit())?;
    let (max, _) = take_number(&rest[max_start..])?;

    let tail = &text[header_end + "players online".len()..];
    let mut names = Vec::new();
    let mut seen = HashSet::new();
    for (index, line) in tail.lines().enumerate() {
        // The header line's names follow its colon; later lines are either a
        // bare name list (legacy) or `group: names` (EssentialsX).
        let list = match line.split_once(':') {
            Some((_, after)) => after,
            None if index == 0 => "",
            None => line,
        };
        for entry in list.split(',') {
            let name = entry.split(" (").next().unwrap_or("").trim();
            if is_valid_player_name(name) && seen.insert(name.to_ascii_lowercase()) {
                names.push(name.to_string());
            }
        }
    }

    Some(PlayerList { online, max, names })
}

/// Parses a `gamerule <rule>` query reply: "Gamerule keepInventory is currently
/// set to: false" (1.13+) or "keepInventory = false" (older). An error reply
/// (unknown rule) yields `None`.
pub(in crate::app) fn parse_gamerule_bool(response: &str) -> Option<bool> {
    let text = strip_formatting(response);
    let last = text
        .split_whitespace()
        .last()?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    match last.as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

/// Lower-cased names from a server list file like `ops.json` or
/// `whitelist.json` (an array of `{ "name": … }`). Missing or unreadable files
/// read as empty.
fn read_listed_names(path: &Path) -> HashSet<String> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return HashSet::new();
    };
    let Ok(serde_json::Value::Array(entries)) = serde_json::from_str(&raw) else {
        return HashSet::new();
    };
    entries
        .iter()
        .filter_map(|entry| entry.get("name")?.as_str())
        .map(str::to_ascii_lowercase)
        .collect()
}

fn query_player_list(client: &mut RconClient) -> Result<PlayerList, String> {
    let mut last_error = None;
    for command in LIST_COMMANDS {
        match client.command(command) {
            Ok(response) => {
                if let Some(list) = parse_player_list(&response) {
                    return Ok(list);
                }
            }
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error.unwrap_or_else(|| "The server didn't return a player list.".to_string()))
}

fn query_keep_inventory(client: &mut RconClient) -> Option<(bool, String)> {
    KEEP_INVENTORY_RULES.iter().find_map(|rule| {
        let response = client.command(&format!("gamerule {rule}")).ok()?;
        parse_gamerule_bool(&response).map(|value| (value, (*rule).to_string()))
    })
}

/// Connects over RCON and reads the online players and the keep inventory rule.
pub(in crate::app) fn query_online_players(
    host: &str,
    rcon: &RconConfig,
    directory: &Path,
) -> Result<OnlinePlayers, String> {
    let mut client = RconClient::connect(host, rcon.port, &rcon.password, RCON_TIMEOUT)?;
    let list = query_player_list(&mut client)?;
    let keep_inventory = query_keep_inventory(&mut client);

    let ops = read_listed_names(&directory.join("ops.json"));
    let whitelist = read_listed_names(&directory.join("whitelist.json"));
    let players = list
        .names
        .into_iter()
        .map(|name| {
            let key = name.to_ascii_lowercase();
            OnlinePlayer {
                is_op: ops.contains(&key),
                is_whitelisted: whitelist.contains(&key),
                name,
            }
        })
        .collect();

    Ok(OnlinePlayers {
        online: list.online,
        max: list.max,
        players,
        keep_inventory: keep_inventory.as_ref().map(|(value, _)| *value),
        keep_inventory_rule: keep_inventory.map(|(_, rule)| rule),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::support::testkit::{FakeMinecraftServer, FakeServerConfig};

    fn names(list: &PlayerList) -> Vec<&str> {
        list.names.iter().map(String::as_str).collect()
    }

    #[test]
    fn parses_the_modern_list_reply() {
        let list =
            parse_player_list("There are 2 of a max of 20 players online: Steve, Alex_99").unwrap();
        assert_eq!((list.online, list.max), (2, 20));
        assert_eq!(names(&list), ["Steve", "Alex_99"]);
    }

    #[test]
    fn parses_an_empty_server() {
        let list = parse_player_list("There are 0 of a max of 20 players online: ").unwrap();
        assert_eq!((list.online, list.max), (0, 20));
        assert!(list.names.is_empty());
    }

    #[test]
    fn keeps_only_the_name_from_list_uuids() {
        let list = parse_player_list(
            "There are 1 of a max of 10 players online: Notch (069a79f4-44e9-4726-a5be-fca90e38aaf5)",
        )
        .unwrap();
        assert_eq!(names(&list), ["Notch"]);
    }

    #[test]
    fn parses_the_legacy_slash_form_with_names_on_the_next_line() {
        let list = parse_player_list("There are 2/20 players online:\nSteve, Alex").unwrap();
        assert_eq!((list.online, list.max), (2, 20));
        assert_eq!(names(&list), ["Steve", "Alex"]);
    }

    #[test]
    fn parses_essentials_style_group_lines_and_strips_colors() {
        let list = parse_player_list(
            "§6There are §c2§6 out of maximum §c20§6 players online.\n§6Admins§r: §fSteve\n§6default§r: §fAlex",
        )
        .unwrap();
        assert_eq!((list.online, list.max), (2, 20));
        assert_eq!(names(&list), ["Steve", "Alex"]);
    }

    #[test]
    fn drops_names_that_could_inject_commands() {
        let list = parse_player_list(
            "There are 3 of a max of 20 players online: Steve, bad name, x;op me, [Admin]Alex",
        )
        .unwrap();
        assert_eq!(names(&list), ["Steve"]);
    }

    #[test]
    fn rejects_replies_that_are_not_a_player_list() {
        assert!(parse_player_list("Unknown or incomplete command, see below for error").is_none());
        assert!(parse_player_list("").is_none());
    }

    #[test]
    fn validates_player_names() {
        assert!(is_valid_player_name("Steve"));
        assert!(is_valid_player_name("a_b_1234567890ab"));
        assert!(!is_valid_player_name(""));
        assert!(!is_valid_player_name("a_b_1234567890abc"));
        assert!(!is_valid_player_name("bad name"));
        assert!(!is_valid_player_name("Stéve"));
    }

    #[test]
    fn parses_gamerule_replies() {
        assert_eq!(
            parse_gamerule_bool("Gamerule keepInventory is currently set to: false"),
            Some(false)
        );
        assert_eq!(parse_gamerule_bool("keepInventory = true"), Some(true));
        assert_eq!(
            parse_gamerule_bool(
                "Incorrect argument for command\n...gamerule keepInventory<--[HERE]"
            ),
            None
        );
        assert_eq!(parse_gamerule_bool(""), None);
    }

    #[test]
    fn queries_players_rules_and_list_files_over_rcon() {
        let server = FakeMinecraftServer::start(FakeServerConfig {
            commands: vec![
                // `list uuids` is unknown here, so the query falls through.
                (
                    "minecraft:list uuids".to_string(),
                    "There are 2 of a max of 20 players online: Steve (uuid-1), Alex (uuid-2)"
                        .to_string(),
                ),
                (
                    "gamerule keep_inventory".to_string(),
                    "Gamerule minecraft:keep_inventory is currently set to: true".to_string(),
                ),
            ],
            ..FakeServerConfig::default()
        });
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("ops.json"),
            r#"[{"uuid":"uuid-1","name":"steve","level":4}]"#,
        )
        .unwrap();
        std::fs::write(
            directory.path().join("whitelist.json"),
            r#"[{"uuid":"uuid-2","name":"Alex"}]"#,
        )
        .unwrap();

        let rcon = RconConfig {
            port: server.rcon_port.unwrap(),
            password: "secret".to_string(),
        };
        let result = query_online_players(&server.host, &rcon, directory.path()).unwrap();

        assert_eq!((result.online, result.max), (2, 20));
        assert_eq!(
            result.players,
            vec![
                OnlinePlayer {
                    name: "Steve".to_string(),
                    is_op: true,
                    is_whitelisted: false,
                },
                OnlinePlayer {
                    name: "Alex".to_string(),
                    is_op: false,
                    is_whitelisted: true,
                },
            ]
        );
        assert_eq!(result.keep_inventory, Some(true));
        assert_eq!(
            result.keep_inventory_rule.as_deref(),
            Some("keep_inventory")
        );
    }

    #[test]
    fn reports_an_error_when_no_list_command_answers() {
        let server = FakeMinecraftServer::start(FakeServerConfig::default());
        let rcon = RconConfig {
            port: server.rcon_port.unwrap(),
            password: "secret".to_string(),
        };
        let directory = tempfile::tempdir().unwrap();
        assert!(query_online_players(&server.host, &rcon, directory.path()).is_err());
    }
}
