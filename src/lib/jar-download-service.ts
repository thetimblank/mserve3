import { invoke } from '@tauri-apps/api/core';
import {
	createDefaultProviderChecks,
	type Provider,
	type ProviderName,
	type ProviderTab,
} from '@/lib/mserve-schema';
import {
	getProviderDescriptor,
	getProviderDescriptorsForTab,
	getProviderDisplayName,
} from '@/lib/server-provider';
import { resolveJavaRequirement } from '@/lib/java-compatibility';

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

/** A selectable version in the picker. Download/version specifics are resolved
 *  lazily via {@link resolveJarRow} when the user commits to a row. */
export type JarVersionRow = {
	id: string;
	tab: JarTab;
	providerId: ProviderName;
	provider: string;
	providerDescription: string;
	version: string;
	minecraftVersion: string;
	stability: JarStability;
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

/** Raw entry returned by the backend `list_provider_versions` command. */
type ProviderVersionEntry = {
	provider: ProviderName;
	tab: JarTab;
	version: string;
	minecraftVersion: string;
	stability: JarStability;
};

/** Raw result returned by the backend `resolve_provider_version` command. */
type ResolvedProviderResult = {
	name: ProviderName;
	file: string;
	downloadUrl: string;
	providerVersion: string;
	minecraftVersion: string;
	jdkVersions: number[];
	stable: boolean;
	sizeBytes?: number;
	sha256?: string;
};

const toRowId = (entry: ProviderVersionEntry) =>
	`${entry.provider}-${entry.stability}-${entry.version}`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');

const toRow = (entry: ProviderVersionEntry): JarVersionRow => {
	const descriptor = getProviderDescriptor(entry.provider);
	return {
		id: toRowId(entry),
		tab: entry.tab,
		providerId: entry.provider,
		provider: getProviderDisplayName(entry.provider),
		providerDescription: descriptor?.description ?? '',
		version: entry.version,
		minecraftVersion: entry.minecraftVersion,
		stability: entry.stability,
	};
};

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

const getProviderFiltersForTab = (tab: JarTab): JarProviderFilterDefinition[] =>
	getProviderDescriptorsForTab(tab).map((descriptor) => ({
		id: descriptor.name,
		label: getProviderDisplayName(descriptor.name),
		description: descriptor.description,
	}));

const PROVIDER_FILTERS_BY_TAB: Record<JarTab, JarProviderFilterDefinition[]> = {
	plugin: getProviderFiltersForTab('plugin'),
	vanilla: getProviderFiltersForTab('vanilla'),
	proxies: getProviderFiltersForTab('proxies'),
};

const getStabilityLabels = (tab: JarTab) => {
	const descriptor = getProviderDescriptorsForTab(tab)[0];
	return {
		stableLabel: descriptor?.stable_name ?? (tab === 'vanilla' ? 'Release' : 'Stable'),
		unstableLabel: descriptor?.unstable_name ?? (tab === 'vanilla' ? 'Snapshot' : 'Unstable'),
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

/** The stability filter ids that correspond to unstable channels for a tab.
 *  Selecting one of these requires fetching the (larger) unstable version set. */
export const UNSTABLE_STABILITY_IDS: Record<JarTab, JarStabilityFilterId> = {
	plugin: 'unstable',
	vanilla: 'snapshot',
	proxies: 'unstable',
};

export const getJarTabs = (): JarTabDefinition[] =>
	(['plugin', 'vanilla', 'proxies'] as const).map((tab) => JAR_TAB_DEFINITIONS[tab]);

export const getJarTabInfo = (tab: JarTab): JarTabDefinition => JAR_TAB_DEFINITIONS[tab];

export const getJarFiltersForTab = (tab: JarTab): JarFilterDefinitions => ({
	providers: PROVIDER_FILTERS_BY_TAB[tab],
	stabilities: STABILITY_FILTERS_BY_TAB[tab],
});

export const fetchJarRows = async (tab: JarTab, includeUnstable: boolean): Promise<JarVersionRow[]> => {
	const entries = await invoke<ProviderVersionEntry[]>('list_provider_versions', {
		payload: { tab, includeUnstable },
	});
	return entries.map(toRow);
};

export const formatStabilityLabel = (stability: JarStability | null): string => {
	if (!stability) {
		return 'Stable';
	}

	return `${stability[0].toUpperCase()}${stability.slice(1)}`;
};

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

		const matchesStability = activeStabilityFilterSet.has(row.stability);
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

const jdkVersionsFromHeuristic = (providerId: ProviderName, minecraftVersion: string): number[] => {
	const requirement = resolveJavaRequirement(providerId, minecraftVersion);
	return Array.from(new Set([requirement.minimumMajor, requirement.recommendedMajor])).sort(
		(left, right) => left - right,
	);
};

/** Resolves the exact build for a row into a fully-populated {@link Provider}. */
export const resolveJarRow = async (row: JarVersionRow): Promise<{ provider: Provider; downloadUrl: string }> => {
	const resolved = await invoke<ResolvedProviderResult>('resolve_provider_version', {
		payload: { provider: row.providerId, version: row.version, stability: row.stability },
	});

	// Vanilla carries an exact JDK from Mojang's metadata; other providers use
	// the per-version heuristic in java-compatibility.
	const jdkVersions =
		resolved.jdkVersions.length > 0
			? resolved.jdkVersions
			: jdkVersionsFromHeuristic(resolved.name, resolved.minecraftVersion);

	const provider: Provider = {
		name: resolved.name,
		file: resolved.file,
		download_url: resolved.downloadUrl,
		provider_version: resolved.providerVersion,
		minecraft_version: resolved.minecraftVersion,
		jdk_versions: jdkVersions,
		supported_telemetry: createDefaultProviderChecks(),
		stable: resolved.stable,
	};

	return { provider, downloadUrl: resolved.downloadUrl };
};

type DownloadJarRowOptions = {
	downloadId?: string;
};

/** Resolves a row, downloads its jar, and returns the resolved provider with the
 *  downloaded jar path applied as its `file`. */
export const downloadAndResolveJarRow = async (
	row: JarVersionRow,
	options?: DownloadJarRowOptions,
): Promise<{ result: DownloadServerJarResult; provider: Provider }> => {
	const { provider, downloadUrl } = await resolveJarRow(row);

	const payload: DownloadServerJarPayload = {
		url: downloadUrl,
		preferredFileName: provider.file,
		downloadId: options?.downloadId,
	};

	const result = await invoke<DownloadServerJarResult>('download_server_jar', { payload });

	return { result, provider: { ...provider, file: result.path } };
};
