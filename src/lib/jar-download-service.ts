import { invoke } from '@tauri-apps/api/core';
import type { ServerProvider } from '@/lib/server-provider';

export type JarTab = 'plugin' | 'vanilla' | 'proxies';

export type JarStability = 'stable' | 'unstable' | 'release' | 'snapshot';

export type JarProviderFilterId = ServerProvider;

export type JarStabilityFilterId = JarStability;

export type JarTabDefinition = {
	id: JarTab;
	label: string;
	description: string;
};

export type JarProviderFilterDefinition = {
	id: JarProviderFilterId;
	label: string;
	description: string;
};

export type JarStabilityFilterDefinition = {
	id: JarStabilityFilterId;
	label: string;
	description: string;
};

export type JarFilterDefinitions = {
	providers: JarProviderFilterDefinition[];
	stabilities: JarStabilityFilterDefinition[];
};

export type JarVersionRow = {
	id: string;
	tab: JarTab;
	providerId: ServerProvider;
	provider: string;
	providerDescription: string;
	version: string;
	stability: JarStability | null;
	downloadUrl?: string;
	preferredFileName?: string;
};

export type DownloadServerJarPayload = {
	url: string;
	preferredFileName?: string;
	downloadId?: string;
};

export type DownloadServerJarResult = {
	path: string;
	fileName: string;
	sizeBytes: number;
};

export type DownloadServerJarProgressEvent = {
	downloadId: string;
	downloadedBytes: number;
	totalBytes: number | null;
	progress: number;
	done: boolean;
};

export const JAR_TAB_DEFINITIONS: Record<JarTab, JarTabDefinition> = {
	plugin: {
		id: 'plugin',
		label: 'Plugin',
		description: 'Plugin-capable servers. Performant but may be less true to vanilla.',
	},
	vanilla: {
		id: 'vanilla',
		label: 'Vanilla',
		description: 'Official Mojang servers. No Plugins. True vanilla, but may suffer performance.',
	},
	proxies: {
		id: 'proxies',
		label: 'Proxies',
		description: 'Network proxy software for routing players across multiple backend servers.',
	},
};

const PROVIDER_FILTERS_BY_TAB: Record<JarTab, JarProviderFilterDefinition[]> = {
	vanilla: [
		{
			id: 'vanilla',
			label: 'Vanilla',
			description: 'Official Mojang server software for pure vanilla gameplay.',
		},
	],
	plugin: [
		{
			id: 'paper',
			label: 'Paper',
			description: 'High-performance Paper server with broad plugin compatibility.',
		},
		{
			id: 'folia',
			label: 'Folia',
			description: 'Regionized-threading server software from the Paper ecosystem.',
		},
		{
			id: 'spigot',
			label: 'Spigot',
			description: 'Classic Bukkit-compatible server software for plugin ecosystems.',
		},
	],
	proxies: [
		{
			id: 'velocity',
			label: 'Velocity',
			description: 'Fast modern proxy for multi-server networks.',
		},
		{
			id: 'bungeecord',
			label: 'Bungeecord',
			description: 'Legacy proxy option used in older multi-server setups.',
		},
	],
};

const STABILITY_FILTERS_BY_TAB: Record<JarTab, JarStabilityFilterDefinition[]> = {
	vanilla: [
		{
			id: 'release',
			label: 'Release',
			description: 'Stable, official game versions intended for production servers.',
		},
		{
			id: 'snapshot',
			label: 'Snapshot',
			description: 'Weekly experimental builds for testing future features.',
		},
	],
	plugin: [
		{
			id: 'stable',
			label: 'Stable',
			description: 'Recommended builds intended for reliable long-running servers.',
		},
		{
			id: 'unstable',
			label: 'Unstable',
			description: 'Early or preview builds for testing upcoming changes.',
		},
	],
	proxies: [
		{
			id: 'stable',
			label: 'Stable',
			description: 'Recommended builds intended for reliable proxy deployments.',
		},
		{
			id: 'unstable',
			label: 'Unstable',
			description: 'Preview builds for testing upcoming proxy behavior.',
		},
	],
};

const STATIC_ROWS: JarVersionRow[] = [
	{
		id: 'vanilla-release-1-21-11',
		tab: 'vanilla',
		providerId: 'vanilla',
		provider: 'Vanilla',
		providerDescription: 'Official Mojang server jar.',
		version: '1.21.11',
		stability: 'release',
		downloadUrl:
			'https://piston-data.mojang.com/v1/objects/97ccd4c0ed3f81bbb7bfacddd1090b0c56f9bc51/server.jar',
		preferredFileName: 'vanilla-1.21.11.jar',
	},
	{
		id: 'paper-stable-1-21-11-130',
		tab: 'plugin',
		providerId: 'paper',
		provider: 'Paper',
		providerDescription: 'High-performance Paper server with plugin support.',
		version: '1.21.11',
		stability: 'stable',
		downloadUrl:
			'https://fill-data.papermc.io/v1/objects/25eb85bd8415195ce4bc188e1939e0c7cef77fb51d26d4e766407ee922561097/paper-1.21.11-130.jar',
		preferredFileName: 'paper-1.21.11-130.jar',
	},
	{
		id: 'folia-stable-1-21-11-14',
		tab: 'plugin',
		providerId: 'folia',
		provider: 'Folia',
		providerDescription: 'Regionized-threading server software from the PaperMC ecosystem.',
		version: '1.21.11',
		stability: 'stable',
		downloadUrl:
			'https://fill-data.papermc.io/v1/objects/f52c408490a0225611e67907a3ca19f7e6da2c6bc899e715d5f46844e7103c39/folia-1.21.11-14.jar',
		preferredFileName: 'folia-1.21.11-14.jar',
	},
	{
		id: 'velocity-stable-3-5-0-snapshot-592',
		tab: 'proxies',
		providerId: 'velocity',
		provider: 'Velocity',
		providerDescription: 'Fast modern proxy for multi-server networks.',
		version: '3.5.0-SNAPSHOT-592',
		stability: 'stable',
		downloadUrl:
			'https://fill-data.papermc.io/v1/objects/495f8ec5717edef9975383976c0b3e497a5509a9115d04c07fce16de11b6a72a/velocity-3.5.0-SNAPSHOT-592.jar',
		preferredFileName: 'velocity-3.5.0-SNAPSHOT-592.jar',
	},
];

export const getJarTabs = (): JarTabDefinition[] =>
	(['plugin', 'vanilla', 'proxies'] as const).map((tab) => JAR_TAB_DEFINITIONS[tab]);

export const getJarTabInfo = (tab: JarTab): JarTabDefinition => JAR_TAB_DEFINITIONS[tab];

export const getJarFiltersForTab = (tab: JarTab): JarFilterDefinitions => ({
	providers: PROVIDER_FILTERS_BY_TAB[tab],
	stabilities: STABILITY_FILTERS_BY_TAB[tab],
});

export const fetchJarRows = async (tab: JarTab): Promise<JarVersionRow[]> => {
	// Keep this async so the UI contract remains stable when switching to API-backed providers.
	return Promise.resolve(STATIC_ROWS.filter((row) => row.tab === tab));
};

export const formatStabilityLabel = (stability: JarStability | null): string => {
	if (!stability) {
		return 'Stable';
	}

	return `${stability[0].toUpperCase()}${stability.slice(1)}`;
};

export const isJarRowDownloadable = (row: JarVersionRow): boolean => Boolean(row.downloadUrl);

export const filterJarRows = (
	rows: JarVersionRow[],
	searchTerm: string,
	activeProviderFilterIds: JarProviderFilterId[],
	activeStabilityFilterIds: JarStabilityFilterId[],
): JarVersionRow[] => {
	const normalizedSearch = searchTerm.trim().toLowerCase();
	const activeProviderFilterSet = new Set(activeProviderFilterIds);
	const activeStabilityFilterSet = new Set(activeStabilityFilterIds);

	return rows.filter((row) => {
		const matchesProvider = activeProviderFilterSet.has(row.providerId);
		if (!matchesProvider) {
			return false;
		}

		const stabilityFilterId: JarStabilityFilterId = row.stability ?? 'stable';
		const matchesStability = activeStabilityFilterSet.has(stabilityFilterId);
		if (!matchesStability) {
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

	const providerPart = row.providerId.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
	const versionPart = row.version.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
	return `${providerPart}-${versionPart}.jar`;
};

type DownloadJarRowOptions = {
	downloadId?: string;
};

export const downloadJarRow = async (
	row: JarVersionRow,
	options?: DownloadJarRowOptions,
): Promise<DownloadServerJarResult> => {
	if (!row.downloadUrl) {
		throw new Error('This provider version is not available for download yet.');
	}

	const payload: DownloadServerJarPayload = {
		url: row.downloadUrl,
		preferredFileName: buildDefaultFileName(row),
		downloadId: options?.downloadId,
	};

	return invoke<DownloadServerJarResult>('download_server_jar', { payload });
};
