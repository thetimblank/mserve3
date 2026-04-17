import { invoke } from '@tauri-apps/api/core';

export type JarTab = 'plugin' | 'vanilla' | 'proxies';

export type JarStability = 'stable' | 'unstable' | 'release' | 'snapshot';

export type JarFilterId =
	| 'vanilla-release'
	| 'vanilla-snapshot'
	| 'paper-stable'
	| 'paper-unstable'
	| 'folia-stable'
	| 'folia-unstable'
	| 'spigot'
	| 'velocity-stable'
	| 'velocity-unstable'
	| 'bungeecord';

export type JarTabDefinition = {
	id: JarTab;
	label: string;
	description: string;
};

export type JarFilterDefinition = {
	id: JarFilterId;
	label: string;
	description: string;
};

export type JarVersionRow = {
	id: string;
	tab: JarTab;
	provider: string;
	providerDescription: string;
	version: string;
	stability: JarStability | null;
	filterIds: JarFilterId[];
	downloadUrl?: string;
	preferredFileName?: string;
};

export type DownloadServerJarPayload = {
	url: string;
	preferredFileName?: string;
};

export type DownloadServerJarResult = {
	path: string;
	fileName: string;
	sizeBytes: number;
};

export const JAR_TAB_DEFINITIONS: Record<JarTab, JarTabDefinition> = {
	plugin: {
		id: 'plugin',
		label: 'Plugin',
		description:
			'Plugin-capable server software such as Paper and Folia. Use this when you want Bukkit-style plugin support.',
	},
	vanilla: {
		id: 'vanilla',
		label: 'Vanilla',
		description:
			'Official Mojang server software. Use this for pure vanilla gameplay with no plugin framework.',
	},
	proxies: {
		id: 'proxies',
		label: 'Proxies',
		description:
			'Network proxy software for routing players across multiple backend servers, like Velocity and BungeeCord.',
	},
};

const FILTERS_BY_TAB: Record<JarTab, JarFilterDefinition[]> = {
	vanilla: [
		{
			id: 'vanilla-release',
			label: 'Release',
			description: 'Stable, official game versions intended for production servers.',
		},
		{
			id: 'vanilla-snapshot',
			label: 'Snapshot',
			description: 'Weekly experimental builds for testing future features.',
		},
	],
	plugin: [
		{
			id: 'paper-stable',
			label: 'Paper (Stable)',
			description: 'Recommended Paper builds for reliable plugin servers.',
		},
		{
			id: 'paper-unstable',
			label: 'Paper (Unstable)',
			description: 'Cutting-edge Paper builds for early testing and development.',
		},
		{
			id: 'folia-stable',
			label: 'Folia (Stable)',
			description: 'Folia builds intended for stable regionized-threading deployments.',
		},
		{
			id: 'folia-unstable',
			label: 'Folia (Unstable)',
			description: 'Experimental Folia builds for testing new scheduling/runtime behavior.',
		},
		{
			id: 'spigot',
			label: 'Spigot',
			description: 'Classic Bukkit-compatible server software for plugin ecosystems.',
		},
	],
	proxies: [
		{
			id: 'velocity-stable',
			label: 'Velocity (Stable)',
			description: 'Recommended Velocity builds for production proxy networks.',
		},
		{
			id: 'velocity-unstable',
			label: 'Velocity (Unstable)',
			description: 'Preview Velocity builds for testing upcoming proxy changes.',
		},
		{
			id: 'bungeecord',
			label: 'Bungeecord',
			description: 'Legacy proxy option used in older multi-server setups.',
		},
	],
};

const STATIC_ROWS: JarVersionRow[] = [
	{
		id: 'vanilla-release-1-21-11',
		tab: 'vanilla',
		provider: 'Vanilla',
		providerDescription: 'Official Mojang server jar.',
		version: '1.21.11',
		stability: 'release',
		filterIds: ['vanilla-release'],
		downloadUrl:
			'https://piston-data.mojang.com/v1/objects/97ccd4c0ed3f81bbb7bfacddd1090b0c56f9bc51/server.jar',
		preferredFileName: 'vanilla-1.21.11.jar',
	},
	{
		id: 'paper-stable-1-21-11-130',
		tab: 'plugin',
		provider: 'Paper',
		providerDescription: 'High-performance Paper server with plugin support.',
		version: '1.21.11',
		stability: 'stable',
		filterIds: ['paper-stable'],
		downloadUrl:
			'https://fill-data.papermc.io/v1/objects/25eb85bd8415195ce4bc188e1939e0c7cef77fb51d26d4e766407ee922561097/paper-1.21.11-130.jar',
		preferredFileName: 'paper-1.21.11-130.jar',
	},
	{
		id: 'paper-unstable-placeholder',
		tab: 'plugin',
		provider: 'Paper',
		providerDescription: 'Unstable Paper channel placeholder until API source is available.',
		version: 'latest-dev',
		stability: 'unstable',
		filterIds: ['paper-unstable'],
	},
	{
		id: 'folia-stable-1-21-11-14',
		tab: 'plugin',
		provider: 'Folia',
		providerDescription: 'Regionized-threading server software from the PaperMC ecosystem.',
		version: '1.21.11',
		stability: 'stable',
		filterIds: ['folia-stable'],
		downloadUrl:
			'https://fill-data.papermc.io/v1/objects/f52c408490a0225611e67907a3ca19f7e6da2c6bc899e715d5f46844e7103c39/folia-1.21.11-14.jar',
		preferredFileName: 'folia-1.21.11-14.jar',
	},
	{
		id: 'folia-unstable-placeholder',
		tab: 'plugin',
		provider: 'Folia',
		providerDescription: 'Unstable Folia channel placeholder until API source is available.',
		version: 'latest-dev',
		stability: 'unstable',
		filterIds: ['folia-unstable'],
	},
	{
		id: 'spigot-placeholder',
		tab: 'plugin',
		provider: 'Spigot',
		providerDescription: 'Spigot provider placeholder until URL source is available.',
		version: 'latest',
		stability: null,
		filterIds: ['spigot'],
	},
	{
		id: 'velocity-stable-3-5-0-snapshot-592',
		tab: 'proxies',
		provider: 'Velocity',
		providerDescription: 'Fast modern proxy for multi-server networks.',
		version: '3.5.0-SNAPSHOT-592',
		stability: 'stable',
		filterIds: ['velocity-stable'],
		downloadUrl:
			'https://fill-data.papermc.io/v1/objects/495f8ec5717edef9975383976c0b3e497a5509a9115d04c07fce16de11b6a72a/velocity-3.5.0-SNAPSHOT-592.jar',
		preferredFileName: 'velocity-3.5.0-SNAPSHOT-592.jar',
	},
	{
		id: 'velocity-unstable-placeholder',
		tab: 'proxies',
		provider: 'Velocity',
		providerDescription: 'Unstable Velocity channel placeholder until API source is available.',
		version: 'latest-dev',
		stability: 'unstable',
		filterIds: ['velocity-unstable'],
	},
	{
		id: 'bungeecord-placeholder',
		tab: 'proxies',
		provider: 'Bungeecord',
		providerDescription: 'Bungeecord provider placeholder until URL source is available.',
		version: 'latest',
		stability: null,
		filterIds: ['bungeecord'],
	},
];

export const getJarTabs = (): JarTabDefinition[] =>
	(['plugin', 'vanilla', 'proxies'] as const).map((tab) => JAR_TAB_DEFINITIONS[tab]);

export const getJarTabInfo = (tab: JarTab): JarTabDefinition => JAR_TAB_DEFINITIONS[tab];

export const getJarFiltersForTab = (tab: JarTab): JarFilterDefinition[] => FILTERS_BY_TAB[tab];

export const fetchJarRows = async (tab: JarTab): Promise<JarVersionRow[]> => {
	// Keep this async so the UI contract remains stable when switching to API-backed providers.
	return Promise.resolve(STATIC_ROWS.filter((row) => row.tab === tab));
};

export const formatStabilityLabel = (stability: JarStability | null): string => {
	switch (stability) {
		case 'stable':
			return 'Stable';
		case 'unstable':
			return 'Unstable';
		case 'release':
			return 'Release';
		case 'snapshot':
			return 'Snapshot';
		default:
			return 'N/A';
	}
};

export const isJarRowDownloadable = (row: JarVersionRow): boolean => Boolean(row.downloadUrl);

export const filterJarRows = (
	rows: JarVersionRow[],
	searchTerm: string,
	activeFilterIds: JarFilterId[],
): JarVersionRow[] => {
	const normalizedSearch = searchTerm.trim().toLowerCase();
	const activeFilterSet = new Set(activeFilterIds);

	return rows.filter((row) => {
		const matchesFilter = row.filterIds.some((filterId) => activeFilterSet.has(filterId));
		if (!matchesFilter) {
			return false;
		}

		if (!normalizedSearch) {
			return true;
		}

		const haystack = [
			row.provider,
			row.providerDescription,
			row.version,
			formatStabilityLabel(row.stability),
		]
			.join(' ')
			.toLowerCase();

		return haystack.includes(normalizedSearch);
	});
};

export const getJarSelectionLabel = (tab: JarTab, version: string): string =>
	`${getJarTabInfo(tab).label} ${version}`;

const buildDefaultFileName = (row: JarVersionRow): string => {
	if (row.preferredFileName?.trim()) {
		return row.preferredFileName.trim();
	}

	const providerPart = row.provider.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
	const versionPart = row.version.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
	return `${providerPart}-${versionPart}.jar`;
};

export const downloadJarRow = async (row: JarVersionRow): Promise<DownloadServerJarResult> => {
	if (!row.downloadUrl) {
		throw new Error('This provider version is not available for download yet.');
	}

	const payload: DownloadServerJarPayload = {
		url: row.downloadUrl,
		preferredFileName: buildDefaultFileName(row),
	};

	return invoke<DownloadServerJarResult>('download_server_jar', { payload });
};
