/**
 * Command builders for the beginner players panel. Every builder validates its
 * input and returns `null` instead of a command when the input is unsafe, so a
 * player name or broadcast text can never smuggle in a second command.
 */
import { buildWhitelistAddCommand, isValidPlayerName } from './console-events';
import { getPrimaryMinecraftVersion } from './utils';

/** One online player, as `get_online_players` reports it. */
export type OnlinePlayer = {
	name: string;
	isOp: boolean;
	isWhitelisted: boolean;
};

/** The `get_online_players` result. */
export type OnlinePlayers = {
	online: number;
	max: number;
	players: OnlinePlayer[];
	/** `null` when the server didn't answer the game rule query. */
	keepInventory: boolean | null;
	/** The rule name the server understood (`keepInventory` before 1.21.11). */
	keepInventoryRule: string | null;
	/** Banned player names, from `banned-players.json`. */
	banned: string[];
};

export const GAME_MODES = ['survival', 'creative', 'adventure', 'spectator'] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const GAME_MODE_LABELS: Record<GameMode, string> = {
	survival: 'Survival',
	creative: 'Creative',
	adventure: 'Adventure',
	spectator: 'Spectator',
};

export type PlayerAction =
	| { kind: 'op' }
	| { kind: 'deop' }
	| { kind: 'kick' }
	| { kind: 'ban' }
	| { kind: 'pardon' }
	| { kind: 'whitelist-add' }
	| { kind: 'lightning' }
	| { kind: 'heal' }
	| { kind: 'gamemode'; mode: GameMode };

export type WorldAction = 'day' | 'night' | 'clear-weather' | 'save';

/** Chat messages longer than this are cut (the client's chat limit). */
export const BROADCAST_MAX_LENGTH = 256;

const KEEP_INVENTORY_RULES = new Set(['keepInventory', 'keep_inventory']);

/**
 * True when the server understands the 1.13+ command syntax (`execute at`,
 * `effect give`). An unknown version is treated as modern: every version mserve
 * can download is.
 */
export const supportsModernCommands = (version: string | null | undefined): boolean => {
	const primary = version ? getPrimaryMinecraftVersion(version) : null;
	if (!primary) return true;
	const [major, minor] = primary.split('.').map(Number);
	// Year-based versions (26.1, …) are newer than every 1.x.
	if (major !== 1) return major > 1;
	return minor >= 13;
};

/** Actions that need the 1.13+ syntax. */
const MODERN_ONLY: ReadonlySet<PlayerAction['kind']> = new Set(['lightning', 'heal']);

export const isPlayerActionAvailable = (kind: PlayerAction['kind'], modernCommands: boolean) =>
	modernCommands || !MODERN_ONLY.has(kind);

/** The console command for a player action, or `null` for an unsafe name. */
export const buildPlayerActionCommand = (action: PlayerAction, player: string): string | null => {
	if (!isValidPlayerName(player)) return null;
	switch (action.kind) {
		case 'op':
			return `op ${player}`;
		case 'deop':
			return `deop ${player}`;
		case 'kick':
			return `kick ${player}`;
		case 'ban':
			return `ban ${player}`;
		case 'pardon':
			return `pardon ${player}`;
		case 'whitelist-add':
			return buildWhitelistAddCommand(player);
		case 'lightning':
			return `execute at ${player} run summon lightning_bolt`;
		case 'heal':
			return `effect give ${player} instant_health 1 10`;
		case 'gamemode':
			return GAME_MODES.includes(action.mode) ? `gamemode ${action.mode} ${player}` : null;
	}
};

/** The toast shown once a player action was sent. */
export const describePlayerAction = (action: PlayerAction, player: string): string => {
	switch (action.kind) {
		case 'op':
			return `${player} is now an operator.`;
		case 'deop':
			return `${player} is no longer an operator.`;
		case 'kick':
			return `Kicked ${player}.`;
		case 'ban':
			return `Banned ${player}.`;
		case 'pardon':
			return `Unbanned ${player}. They can join again.`;
		case 'whitelist-add':
			return `Added ${player} to the whitelist.`;
		case 'lightning':
			return `Struck ${player} with lightning.`;
		case 'heal':
			return `Healed ${player}.`;
		case 'gamemode':
			return `${player} is now in ${GAME_MODE_LABELS[action.mode]} mode.`;
	}
};

const WORLD_COMMANDS: Record<WorldAction, string> = {
	day: 'time set day',
	night: 'time set night',
	'clear-weather': 'weather clear',
	save: 'save-all',
};

const WORLD_ACTION_MESSAGES: Record<WorldAction, string> = {
	day: 'It is now day.',
	night: 'It is now night.',
	'clear-weather': 'The weather is clear.',
	save: 'World saved.',
};

export const buildWorldActionCommand = (action: WorldAction): string => WORLD_COMMANDS[action];

export const describeWorldAction = (action: WorldAction): string => WORLD_ACTION_MESSAGES[action];

/**
 * Broadcast text made safe for one `say` command: line breaks and other
 * control characters become spaces (a newline would end the command and start
 * another), whitespace collapses, and the result is capped at the chat limit.
 */
export const sanitizeBroadcastText = (text: string): string =>
	text
		.replace(/[\u0000-\u001f\u007f]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, BROADCAST_MAX_LENGTH)
		.trim();

/** The `say` command for a broadcast, or `null` when nothing is left to send. */
export const buildBroadcastCommand = (text: string): string | null => {
	const clean = sanitizeBroadcastText(text);
	return clean ? `say ${clean}` : null;
};

/** The `gamerule` command that sets keep inventory, or `null` for an unknown rule name. */
export const buildKeepInventoryCommand = (rule: string, value: boolean): string | null =>
	KEEP_INVENTORY_RULES.has(rule) ? `gamerule ${rule} ${value}` : null;
