import type { ProviderKind } from '@/lib/mserve-schema';

export type ManagedConfigFileFormat = 'json' | 'properties' | 'yaml' | 'toml';

export type ManagedConfigPropertyType = 'boolean' | 'number' | 'string' | 'enum' | 'list' | 'map';

export type ManagedConfigPropertyOption = {
	label: string;
	value: string;
};

export type ManagedConfigPropertyDefinition = {
	key: string;
	label: string;
	description: string;
	type: ManagedConfigPropertyType;
	options?: ManagedConfigPropertyOption[];
	unitLabel?: string;
	multiline?: boolean;
	defaultValue?: string | number | boolean | string[] | Record<string, unknown>;
};

export type ManagedServerConfigFileKind =
	| 'server-properties'
	| 'ops-json'
	| 'whitelist-json'
	| 'banned-ips-json'
	| 'banned-players-json'
	| 'bukkit-yml'
	| 'help-yml'
	| 'commands-yml'
	| 'spigot-yml'
	| 'velocity-toml';

export type ManagedServerConfigFileDefinition = {
	kind: ManagedServerConfigFileKind;
	fileName: string;
	title: string;
	description: string;
	providerKinds: ProviderKind[];
	format: ManagedConfigFileFormat;
	keywords: string[];
	featuredProperties: ManagedConfigPropertyDefinition[];
	networkingDisclaimer?: boolean;
};

export type ManagedConfigFileStatus = {
	fileName: string;
	exists: boolean;
};

export type ManagedConfigFileReadPayload = {
	directory: string;
	fileName: string;
};

export type ManagedConfigFileWritePayload = ManagedConfigFileReadPayload & {
	content: string;
};

export type ManagedConfigFileReadResult = {
	fileName: string;
	content: string;
};

const SERVER_NETWORKING_DISCLAIMER = true;

const SERVER_PROPERTIES_FEATURED_PROPERTIES: ManagedConfigPropertyDefinition[] = [
	{
		key: 'motd',
		label: 'MOTD',
		description: 'Message shown in the multiplayer server list.',
		type: 'string',
		multiline: true,
		defaultValue: 'A Minecraft Server',
	},
	{
		key: 'spawn-protection',
		label: 'Spawn protection',
		description: 'Spawn protection radius around the world spawn point.',
		type: 'number',
		unitLabel: 'Blocks',
		defaultValue: 16,
	},
	{
		key: 'white-list',
		label: 'Whitelist',
		description: 'Require players to be whitelisted before they can join.',
		type: 'boolean',
		defaultValue: false,
	},
	{
		key: 'view-distance',
		label: 'View distance',
		description: 'Chunk view distance used by the server.',
		type: 'number',
		unitLabel: 'Chunks',
		defaultValue: 10,
	},
	{
		key: 'max-players',
		label: 'Max players',
		description: 'Maximum number of players allowed online.',
		type: 'number',
		unitLabel: 'Players',
		defaultValue: 20,
	},
	{
		key: 'gamemode',
		label: 'Gamemode',
		description: 'Default gamemode assigned to new players.',
		type: 'enum',
		options: [
			{ label: 'Survival', value: 'survival' },
			{ label: 'Creative', value: 'creative' },
			{ label: 'Adventure', value: 'adventure' },
			{ label: 'Spectator', value: 'spectator' },
		],
		defaultValue: 'survival',
	},
	{
		key: 'difficulty',
		label: 'Difficulty',
		description: 'World difficulty setting used by the server.',
		type: 'enum',
		options: [
			{ label: 'Peaceful', value: 'peaceful' },
			{ label: 'Easy', value: 'easy' },
			{ label: 'Normal', value: 'normal' },
			{ label: 'Hard', value: 'hard' },
		],
		defaultValue: 'easy',
	},
	{
		key: 'server-port',
		label: 'Server port',
		description: 'Port the server listens on for player connections.',
		type: 'number',
		unitLabel: 'Port',
		defaultValue: 25565,
	},
	{
		key: 'server-ip',
		label: 'Server IP',
		description: 'Optional bind address for the server socket.',
		type: 'string',
		defaultValue: '',
	},
	{
		key: 'online-mode',
		label: 'Online mode',
		description: 'Authenticate players with Mojang.',
		type: 'boolean',
		defaultValue: true,
	},
];

const VELOCITY_FEATURED_PROPERTIES: ManagedConfigPropertyDefinition[] = [
	{
		key: 'motd',
		label: 'MOTD',
		description: 'Message shown in the proxy server list.',
		type: 'string',
		multiline: true,
		defaultValue: 'A Velocity Server',
	},
	{
		key: 'show-max-players',
		label: 'Show max players',
		description: 'Maximum player count shown to clients in the server list.',
		type: 'number',
		unitLabel: 'Players',
	},
	{
		key: 'log-player-connections',
		label: 'Log player connections',
		description: 'Log player connections, server switches, and disconnects.',
		type: 'boolean',
		defaultValue: false,
	},
	{
		key: 'log-command-executions',
		label: 'Log command executions',
		description: 'Log commands run by players on the proxy.',
		type: 'boolean',
		defaultValue: false,
	},
	{
		key: 'bind',
		label: 'Bind',
		description: 'IP address and port the proxy accepts connections on.',
		type: 'string',
		defaultValue: '0.0.0.0:25577',
	},
	{
		key: 'online-mode',
		label: 'Online mode',
		description: 'Authenticate players with Mojang.',
		type: 'boolean',
		defaultValue: true,
	},
	{
		key: 'servers',
		label: 'Servers',
		description: 'Backend server table used by the proxy for named servers.',
		type: 'map',
		multiline: true,
		defaultValue: {},
	},
	{
		key: 'try',
		label: 'Try order',
		description: 'Ordered fallback server list used when a player connects or fails over.',
		type: 'list',
		multiline: true,
		defaultValue: [],
	},
];

const MANAGED_SERVER_CONFIG_FILE_DEFINITIONS: ManagedServerConfigFileDefinition[] = [
	{
		kind: 'server-properties',
		fileName: 'server.properties',
		title: 'server.properties',
		description: 'Canonical server configuration for the running server software.',
		providerKinds: ['plugin', 'vanilla'],
		format: 'properties',
		keywords: [
			'motd',
			'spawn protection',
			'white list',
			'view distance',
			'max players',
			'gamemode',
			'difficulty',
		],
		featuredProperties: SERVER_PROPERTIES_FEATURED_PROPERTIES,
		networkingDisclaimer: SERVER_NETWORKING_DISCLAIMER,
	},
	{
		kind: 'ops-json',
		fileName: 'ops.json',
		title: 'ops.json',
		description: 'Players with operator privileges.',
		providerKinds: ['plugin', 'vanilla'],
		format: 'json',
		keywords: ['operators', 'ops', 'operators list'],
		featuredProperties: [],
	},
	{
		kind: 'whitelist-json',
		fileName: 'whitelist.json',
		title: 'whitelist.json',
		description: 'Players who can join while whitelist mode is enabled.',
		providerKinds: ['plugin', 'vanilla'],
		format: 'json',
		keywords: ['whitelist', 'allowed players'],
		featuredProperties: [],
	},
	{
		kind: 'banned-ips-json',
		fileName: 'banned-ips.json',
		title: 'banned-ips.json',
		description: 'IP addresses that are blocked from joining the server.',
		providerKinds: ['plugin', 'vanilla'],
		format: 'json',
		keywords: ['bans', 'blocked addresses', 'ip bans'],
		featuredProperties: [],
	},
	{
		kind: 'banned-players-json',
		fileName: 'banned-players.json',
		title: 'banned-players.json',
		description: 'Players that are banned from joining the server.',
		providerKinds: ['plugin', 'vanilla'],
		format: 'json',
		keywords: ['bans', 'blocked players', 'player bans'],
		featuredProperties: [],
	},
	{
		kind: 'bukkit-yml',
		fileName: 'bukkit.yml',
		title: 'bukkit.yml',
		description: 'Bukkit compatibility settings.',
		providerKinds: ['plugin'],
		format: 'yaml',
		keywords: ['bukkit', 'paper', 'plugin'],
		featuredProperties: [],
	},
	{
		kind: 'help-yml',
		fileName: 'help.yml',
		title: 'help.yml',
		description: 'Help command configuration.',
		providerKinds: ['plugin'],
		format: 'yaml',
		keywords: ['help', 'commands', 'help command'],
		featuredProperties: [],
	},
	{
		kind: 'commands-yml',
		fileName: 'commands.yml',
		title: 'commands.yml',
		description: 'Command alias and override configuration.',
		providerKinds: ['plugin'],
		format: 'yaml',
		keywords: ['commands', 'aliases', 'command overrides'],
		featuredProperties: [],
	},
	{
		kind: 'spigot-yml',
		fileName: 'spigot.yml',
		title: 'spigot.yml',
		description: 'Spigot tuning and compatibility settings.',
		providerKinds: ['plugin'],
		format: 'yaml',
		keywords: ['spigot', 'performance', 'tuning'],
		featuredProperties: [],
	},
	{
		kind: 'velocity-toml',
		fileName: 'velocity.toml',
		title: 'velocity.toml',
		description: 'Main Velocity proxy configuration file.',
		providerKinds: ['proxy'],
		format: 'toml',
		keywords: ['motd', 'proxy', 'servers', 'forwarding', 'bind'],
		featuredProperties: VELOCITY_FEATURED_PROPERTIES,
		networkingDisclaimer: SERVER_NETWORKING_DISCLAIMER,
	},
];

export const getManagedServerConfigFileDefinitions = (providerKind: ProviderKind) =>
	MANAGED_SERVER_CONFIG_FILE_DEFINITIONS.filter((definition) =>
		definition.providerKinds.includes(providerKind),
	);

export const getManagedServerConfigFileDefinitionByKind = (kind: ManagedServerConfigFileKind) =>
	MANAGED_SERVER_CONFIG_FILE_DEFINITIONS.find((definition) => definition.kind === kind) ?? null;

export const getManagedServerConfigFileDefinitionByFileName = (fileName: string) => {
	const normalized = fileName.trim().toLowerCase();
	if (!normalized) return null;

	return (
		MANAGED_SERVER_CONFIG_FILE_DEFINITIONS.find(
			(definition) => definition.fileName.toLowerCase() === normalized,
		) ?? null
	);
};

export const getManagedServerConfigFileKeywords = (definition: ManagedServerConfigFileDefinition) =>
	Array.from(
		new Set([
			definition.fileName,
			definition.title,
			definition.format,
			...definition.keywords,
			...definition.featuredProperties.map((property) => property.key),
			...definition.featuredProperties.map((property) => property.label),
		]),
	);
