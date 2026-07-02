import { invoke } from '@tauri-apps/api/core';
import type { Provider } from '@/lib/mserve-schema';
import { resolveProvider } from '@/lib/server-provider';

export type ModrinthProjectType = 'plugin' | 'datapack' | 'mod' | 'modpack';

export type ModrinthSortIndex = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';

export type ModrinthVersionChannel = 'release' | 'beta' | 'alpha';

export type ModrinthSearchHit = {
	projectId: string;
	slug: string;
	title: string;
	description: string;
	categories: string[];
	displayCategories: string[];
	versions: string[];
	downloads: number;
	follows: number;
	iconUrl?: string | null;
	author: string;
	dateModified: string;
	serverSide?: string | null;
};

export type ModrinthSearchResult = {
	hits: ModrinthSearchHit[];
	offset: number;
	limit: number;
	totalHits: number;
};

export type ModrinthProjectDetails = {
	id: string;
	slug: string;
	title: string;
	description: string;
	body: string;
	categories: string[];
	additionalCategories: string[];
	gameVersions: string[];
	loaders: string[];
	downloads: number;
	followers: number;
	iconUrl?: string | null;
	sourceUrl?: string | null;
	updated: string;
	published: string;
	projectType: string;
};

export type ModrinthVersion = {
	versionId: string;
	projectId: string;
	name: string;
	versionNumber: string;
	gameVersions: string[];
	loaders: string[];
	versionType: ModrinthVersionChannel;
	datePublished: string;
	downloads: number;
	fileUrl: string;
	fileName: string;
	fileSizeBytes: number;
	sha512?: string;
};

export type ModrinthCategoryTag = {
	name: string;
	projectType: string;
	header: string;
};

export type ModrinthGameVersionTag = {
	version: string;
	versionType: string;
	major: boolean;
};

export type ModrinthTags = {
	categories: ModrinthCategoryTag[];
	gameVersions: ModrinthGameVersionTag[];
};

export type ModrinthSearchParams = {
	projectType: ModrinthProjectType;
	query?: string;
	loaders?: string[];
	gameVersions?: string[];
	categories?: string[];
	index?: ModrinthSortIndex;
	offset?: number;
	limit?: number;
};

export const MODRINTH_PAGE_SIZE = 20;

export const MODRINTH_SORT_OPTIONS: { id: ModrinthSortIndex; label: string }[] = [
	{ id: 'relevance', label: 'Relevance' },
	{ id: 'downloads', label: 'Downloads' },
	{ id: 'follows', label: 'Followers' },
	{ id: 'updated', label: 'Recently updated' },
	{ id: 'newest', label: 'Newest' },
];

export const searchModrinthProjects = (params: ModrinthSearchParams): Promise<ModrinthSearchResult> =>
	invoke<ModrinthSearchResult>('search_modrinth_projects', {
		payload: {
			projectType: params.projectType,
			query: params.query ?? '',
			loaders: params.loaders ?? [],
			gameVersions: params.gameVersions ?? [],
			categories: params.categories ?? [],
			index: params.index ?? 'relevance',
			offset: params.offset ?? 0,
			limit: params.limit ?? MODRINTH_PAGE_SIZE,
		},
	});

export const getModrinthProject = (idOrSlug: string): Promise<ModrinthProjectDetails> =>
	invoke<ModrinthProjectDetails>('get_modrinth_project', { payload: { idOrSlug } });

export const listModrinthProjectVersions = (
	idOrSlug: string,
	filters?: { loaders?: string[]; gameVersions?: string[] },
): Promise<ModrinthVersion[]> =>
	invoke<ModrinthVersion[]>('list_modrinth_project_versions', {
		payload: {
			idOrSlug,
			loaders: filters?.loaders ?? [],
			gameVersions: filters?.gameVersions ?? [],
		},
	});

export const getModrinthTags = (projectType: ModrinthProjectType): Promise<ModrinthTags> =>
	invoke<ModrinthTags>('get_modrinth_tags', { projectType });

export type InstallModrinthFileParams = {
	directory: string;
	itemType: 'plugin' | 'datapack' | 'mod';
	version: ModrinthVersion;
	projectTitle: string;
	pageUrl: string;
};

export type InstallModrinthFileResult = {
	file: string;
	sizeBytes: number;
};

export const installModrinthFile = (
	params: InstallModrinthFileParams,
): Promise<InstallModrinthFileResult> =>
	invoke<InstallModrinthFileResult>('install_modrinth_file', {
		payload: {
			directory: params.directory,
			itemType: params.itemType,
			url: params.version.fileUrl,
			fileName: params.version.fileName,
			sha512: params.version.sha512,
			projectId: params.version.projectId,
			versionId: params.version.versionId,
			name: params.projectTitle,
			pageUrl: params.pageUrl,
		},
	});

export type ModpackInstallStage =
	| 'downloading-pack'
	| 'extracting'
	| 'downloading-files'
	| 'installing-loader'
	| 'done';

/** Payload of the `modpack-install-progress` backend event. */
export type ModpackInstallProgressEvent = {
	installId: string;
	stage: ModpackInstallStage;
	message: string;
	filesDone: number;
	filesTotal: number;
	progress: number;
	done: boolean;
};

export type InstallModpackResult = {
	directory: string;
	minecraftVersion: string;
	providerName: 'fabric' | 'forge' | 'neoforge';
	loaderVersion: string;
	file: string;
	jdkVersions: number[];
	packName: string;
	packVersion: string;
};

export type InstallModpackParams = {
	directory: string;
	version: ModrinthVersion;
	javaExecutable?: string | null;
	installId?: string;
};

export const installModrinthModpack = (params: InstallModpackParams): Promise<InstallModpackResult> =>
	invoke<InstallModpackResult>('install_modrinth_modpack', {
		payload: {
			directory: params.directory,
			url: params.version.fileUrl,
			sha512: params.version.sha512,
			javaExecutable: params.javaExecutable ?? undefined,
			installId: params.installId,
		},
	});

export const getModrinthProjectPageUrl = (projectType: ModrinthProjectType, slug: string): string =>
	`https://modrinth.com/${projectType}/${slug}`;

/** Modrinth loader facets that can run content for a given server provider. */
const PLUGIN_LOADERS_BY_PROVIDER: Record<string, string[]> = {
	paper: ['paper', 'spigot', 'bukkit'],
	// Folia needs explicit support; paper plugins are not guaranteed to work.
	folia: ['folia'],
	spigot: ['spigot', 'bukkit'],
	velocity: ['velocity'],
	bungeecord: ['bungeecord', 'waterfall'],
};

export const resolveModrinthPluginLoaders = (provider?: Provider | null): string[] => {
	const descriptor = resolveProvider(provider ?? null);
	if (!descriptor) return [];
	return PLUGIN_LOADERS_BY_PROVIDER[descriptor.name] ?? [];
};

const MOD_LOADERS_BY_PROVIDER: Record<string, string[]> = {
	fabric: ['fabric'],
	forge: ['forge'],
	neoforge: ['neoforge'],
};

export const resolveModrinthModLoaders = (provider?: Provider | null): string[] => {
	const descriptor = resolveProvider(provider ?? null);
	if (!descriptor) return [];
	return MOD_LOADERS_BY_PROVIDER[descriptor.name] ?? [];
};

/**
 * The game version to pin search/version filters to for a server. Proxies are
 * effectively version-agnostic, so they get no pin.
 */
export const resolveModrinthGameVersion = (provider?: Provider | null): string | null => {
	const descriptor = resolveProvider(provider ?? null);
	if (!descriptor || descriptor.kind === 'proxy') return null;
	const version = provider?.minecraft_version?.trim() ?? '';
	if (!version || version === 'proxy') return null;
	return version;
};

export const formatModrinthCategoryLabel = (name: string): string =>
	name
		.split('-')
		.map((part) => (part.length === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`))
		.join(' ');

export const formatCompactCount = (value: number): string =>
	new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export const formatModrinthFileSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return `${value.toFixed(1)} ${units[unitIndex]}`;
};

export const formatModrinthDate = (iso: string): string => {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};
