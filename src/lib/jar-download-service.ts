import { invoke } from '@tauri-apps/api/core';
import { type Provider, type ProviderName, type ProviderTab } from '@/lib/mserve-schema';
import { getProviderDisplayName, PROVIDERS } from '@/lib/server-provider';

export type JarTab = ProviderTab;

export type JarStability = 'stable' | 'unstable' | 'release' | 'snapshot';

export type JarProviderFilterId = ProviderName;

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

export type JarVersionRow = Provider & {
	id: string;
	tab: JarTab;
	providerId: ProviderName;
	provider: string;
	providerDescription: string;
	version: string;
	stability: JarStability | null;
	downloadUrl: string | null;
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

const resolveRowVersion = (provider: Provider) => {
	if (provider.tab === 'proxies') {
		return provider.provider_version;
	}
	return provider.minecraft_version || provider.provider_version;
};

const resolveRowStability = (provider: Provider): JarStability => {
	if (provider.tab === 'vanilla') {
		return provider.stable ? 'release' : 'snapshot';
	}
	return provider.stable ? 'stable' : 'unstable';
};

const toRowId = (provider: Provider, stability: JarStability) =>
	`${provider.name}-${stability}-${provider.provider_version || provider.minecraft_version}`
		.toLowerCase()
		.replace(/[^a-z0-9.-]+/g, '-');

const STATIC_ROWS: JarVersionRow[] = PROVIDERS.map((provider) => {
	const stability = resolveRowStability(provider);
	return {
		...provider,
		id: toRowId(provider, stability),
		tab: provider.tab ?? 'plugin',
		providerId: provider.name,
		provider: getProviderDisplayName(provider.name),
		providerDescription: provider.description ?? '',
		version: resolveRowVersion(provider),
		stability,
		downloadUrl: provider.download_url ?? null,
		preferredFileName: provider.file,
	};
});

export const toProviderFromJarRow = (row: JarVersionRow): Provider => ({
	name: row.name,
	file: row.file,
	download_url: row.download_url,
	provider_version: row.provider_version,
	minecraft_version: row.minecraft_version,
	jdk_versions: row.jdk_versions,
	supported_telemetry: row.supported_telemetry,
	stable: row.stable,
	aliases: row.aliases,
	description: row.description,
	kind: row.kind,
	tab: row.tab,
	stable_name: row.stable_name,
	unstable_name: row.unstable_name,
	supports_list_command: row.supports_list_command,
	supports_tps_command: row.supports_tps_command,
	supports_version_command: row.supports_version_command,
});

const JAR_TAB_DEFINITIONS: Record<JarTab, JarTabDefinition> = {
	plugin: {
		id: 'plugin',
		label: 'Plugin',
		description: 'Plugin-capable servers. Performant while keeping broad ecosystem compatibility.',
	},
	vanilla: {
		id: 'vanilla',
		label: 'Vanilla',
		description: 'Official Mojang servers for true vanilla gameplay.',
	},
	proxies: {
		id: 'proxies',
		label: 'Proxies',
		description: 'Network proxy software for routing players across backend servers.',
	},
};

const getRowsForTab = (tab: JarTab) => STATIC_ROWS.filter((row) => row.tab === tab);

const getProviderFiltersForTab = (tab: JarTab): JarProviderFilterDefinition[] => {
	const seen = new Set<JarProviderFilterId>();
	const filters: JarProviderFilterDefinition[] = [];

	for (const row of getRowsForTab(tab)) {
		if (seen.has(row.providerId)) continue;
		seen.add(row.providerId);
		filters.push({
			id: row.providerId,
			label: row.provider,
			description: row.providerDescription,
		});
	}

	return filters;
};

const PROVIDER_FILTERS_BY_TAB: Record<JarTab, JarProviderFilterDefinition[]> = {
	plugin: getProviderFiltersForTab('plugin'),
	vanilla: getProviderFiltersForTab('vanilla'),
	proxies: getProviderFiltersForTab('proxies'),
};

const getStabilityLabels = (tab: JarTab) => {
	const candidate = PROVIDERS.find((provider) => provider.tab === tab);
	return {
		stableLabel: candidate?.stable_name ?? (tab === 'vanilla' ? 'Release' : 'Stable'),
		unstableLabel: candidate?.unstable_name ?? (tab === 'vanilla' ? 'Snapshot' : 'Unstable'),
	};
};

const STABILITY_FILTERS_BY_TAB: Record<JarTab, JarStabilityFilterDefinition[]> = {
	plugin: (() => {
		const labels = getStabilityLabels('plugin');
		return [
			{ id: 'stable', label: labels.stableLabel, description: 'Production-ready releases.' },
			{ id: 'unstable', label: labels.unstableLabel, description: 'Preview or development builds.' },
		];
	})(),
	vanilla: (() => {
		const labels = getStabilityLabels('vanilla');
		return [
			{ id: 'release', label: labels.stableLabel, description: 'Official release channel.' },
			{ id: 'snapshot', label: labels.unstableLabel, description: 'Snapshot channel (may be unstable).' },
		];
	})(),
	proxies: (() => {
		const labels = getStabilityLabels('proxies');
		return [
			{ id: 'stable', label: labels.stableLabel, description: 'Production-ready releases.' },
			{ id: 'unstable', label: labels.unstableLabel, description: 'Preview or development builds.' },
		];
	})(),
};

export const getJarTabs = (): JarTabDefinition[] =>
	(['plugin', 'vanilla', 'proxies'] as const).map((tab) => JAR_TAB_DEFINITIONS[tab]);

export const getJarTabInfo = (tab: JarTab): JarTabDefinition => JAR_TAB_DEFINITIONS[tab];

export const getJarFiltersForTab = (tab: JarTab): JarFilterDefinitions => ({
	providers: PROVIDER_FILTERS_BY_TAB[tab],
	stabilities: STABILITY_FILTERS_BY_TAB[tab],
});

export const fetchJarRows = async (tab: JarTab): Promise<JarVersionRow[]> =>
	Promise.resolve(STATIC_ROWS.filter((row) => row.tab === tab));

export const formatStabilityLabel = (stability: JarStability | null): string => {
	if (!stability) {
		return 'Stable';
	}

	return `${stability[0].toUpperCase()}${stability.slice(1)}`;
};

export const isJarRowDownloadable = (row: JarVersionRow): boolean =>
	Boolean(row.downloadUrl || row.download_url);

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
		if (!matchesProvider) return false;

		const stabilityFilterId: JarStabilityFilterId = row.stability ?? 'stable';
		const matchesStability = activeStabilityFilterSet.has(stabilityFilterId);
		if (!matchesStability) return false;

		if (!normalizedSearch) return true;

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

	if (row.file.trim()) {
		return row.file.trim();
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
	const url = row.downloadUrl ?? row.download_url;
	if (!url) {
		throw new Error('This provider version is not available for download yet.');
	}

	const payload: DownloadServerJarPayload = {
		url,
		preferredFileName: buildDefaultFileName(row),
		downloadId: options?.downloadId,
	};

	return invoke<DownloadServerJarResult>('download_server_jar', { payload });
};
