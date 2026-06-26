import { DEFAULT_SERVER_PROVIDER } from './mserve-consts';
import {
	createDefaultProviderChecks,
	type Provider,
	type ProviderKind,
	type ProviderName,
	type ProviderTab,
} from './mserve-schema';

export type { ProviderName, TelemetryPolling } from './mserve-schema';

/**
 * Static, version-independent metadata for each known provider — the single
 * source of truth for descriptive data. The actual downloadable versions (file,
 * download_url, provider_version, minecraft_version, jdk_versions, stable) are
 * fetched live from the providers' official APIs by the backend
 * `list_provider_versions` / `resolve_provider_version` commands — see
 * {@link file://./jar-download-service.ts}.
 *
 * A {@link Provider} (the per-server `mserve.json` shape) carries none of these
 * fields; consumers join them in by name via {@link getProviderDescriptor}.
 */
export type ProviderDescriptor = {
	name: ProviderName;
	aliases: string[];
	description: string;
	kind: Exclude<ProviderKind, 'unknown'>;
	tab: ProviderTab;
	stable_name: string;
	unstable_name: string;
	supports_list_command: boolean;
	supports_tps_command: boolean;
	supports_version_command: boolean;
	/** Sensible fallback when no live/exact requirement is known (manual flows). */
	default_jdk_versions: number[];
	/**
	 * Detection-only providers (spigot, bungeecord) are recognized from jar names
	 * and config files so imported servers resolve correctly, but they are NOT
	 * offered as a choice in the create wizard (no live download API here).
	 */
	selectable: boolean;
};

const titleCase = (value: string) =>
	value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;

const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
	{
		name: 'paper',
		aliases: ['paper'],
		description: 'High-performance Paper server with broad plugin compatibility',
		kind: 'plugin',
		tab: 'plugin',
		stable_name: 'Stable',
		unstable_name: 'Unstable',
		supports_list_command: true,
		supports_tps_command: true,
		supports_version_command: true,
		default_jdk_versions: [21],
		selectable: true,
	},
	{
		name: 'folia',
		aliases: ['folia'],
		description: 'Regionized-threading server software from the Paper ecosystem',
		kind: 'plugin',
		tab: 'plugin',
		stable_name: 'Stable',
		unstable_name: 'Unstable',
		supports_list_command: true,
		supports_tps_command: true,
		supports_version_command: true,
		default_jdk_versions: [21],
		selectable: true,
	},
	{
		name: 'vanilla',
		aliases: ['vanilla', 'minecraft', 'mojang', 'minecraft_server', 'server'],
		description: 'Official Mojang server software for pure vanilla gameplay',
		kind: 'vanilla',
		tab: 'vanilla',
		stable_name: 'Release',
		unstable_name: 'Snapshot',
		supports_list_command: true,
		supports_tps_command: true,
		supports_version_command: true,
		default_jdk_versions: [21],
		selectable: true,
	},
	{
		name: 'velocity',
		aliases: ['velocity'],
		description: 'Fast modern proxy for multi-server networks',
		kind: 'proxy',
		tab: 'proxies',
		stable_name: 'Stable',
		unstable_name: 'Unstable',
		supports_list_command: true,
		supports_tps_command: false,
		supports_version_command: true,
		default_jdk_versions: [17, 21],
		selectable: true,
	},
	{
		name: 'spigot',
		aliases: ['spigot', 'bukkit', 'craftbukkit'],
		description: 'Spigot/Bukkit plugin server (detected from existing jars)',
		kind: 'plugin',
		tab: 'plugin',
		stable_name: 'Stable',
		unstable_name: 'Unstable',
		supports_list_command: true,
		supports_tps_command: true,
		supports_version_command: true,
		default_jdk_versions: [21],
		selectable: false,
	},
	{
		name: 'bungeecord',
		aliases: ['bungeecord', 'bungee', 'waterfall'],
		description: 'BungeeCord proxy (detected from existing jars)',
		kind: 'proxy',
		tab: 'proxies',
		stable_name: 'Stable',
		unstable_name: 'Unstable',
		supports_list_command: true,
		supports_tps_command: false,
		supports_version_command: true,
		default_jdk_versions: [17, 21],
		selectable: false,
	},
];

const descriptorByName = new Map(PROVIDER_DESCRIPTORS.map((descriptor) => [descriptor.name, descriptor]));

const descriptorByAlias = new Map<string, ProviderDescriptor>();
for (const descriptor of PROVIDER_DESCRIPTORS) {
	descriptorByAlias.set(descriptor.name, descriptor);
	for (const alias of descriptor.aliases) {
		descriptorByAlias.set(alias.trim().toLowerCase(), descriptor);
	}
}

/** Builds the storage-shape {@link Provider} template (no metadata) for a descriptor. */
const descriptorToProviderTemplate = (descriptor: ProviderDescriptor): Provider => ({
	name: descriptor.name,
	file: '',
	download_url: undefined,
	provider_version: '',
	minecraft_version: descriptor.kind === 'proxy' ? 'proxy' : '',
	jdk_versions: [...descriptor.default_jdk_versions],
	supported_telemetry: createDefaultProviderChecks(),
	stable: true,
});

const templateByName = new Map(
	PROVIDER_DESCRIPTORS.map((descriptor) => [descriptor.name, descriptorToProviderTemplate(descriptor)]),
);

/** Provider names that can be picked in the create wizard (excludes detection-only). */
export const PROVIDER_NAMES: ProviderName[] = PROVIDER_DESCRIPTORS.filter(
	(descriptor) => descriptor.selectable,
).map((descriptor) => descriptor.name);

export const getProviderDescriptor = (name?: ProviderName | string | null): ProviderDescriptor | null => {
	if (!name) return null;
	const key = name.trim().toLowerCase();
	return descriptorByName.get(key as ProviderName) ?? descriptorByAlias.get(key) ?? null;
};

/** Descriptors selectable in the given download tab (excludes detection-only). */
export const getProviderDescriptorsForTab = (tab: ProviderTab): ProviderDescriptor[] =>
	PROVIDER_DESCRIPTORS.filter((descriptor) => descriptor.selectable && descriptor.tab === tab);

/** All descriptors, including detection-only ones — for jar/path inference. */
export const getProviderDescriptors = (): ProviderDescriptor[] => PROVIDER_DESCRIPTORS;

export const getProviderDisplayName = (provider: ProviderName | string): string =>
	titleCase(provider.trim().toLowerCase());

const getProviderTemplate = (name?: ProviderName | string | null): Provider | null => {
	const descriptor = getProviderDescriptor(name);
	return descriptor ? templateByName.get(descriptor.name) ?? null : null;
};

/** Resolves any provider reference to its catalog descriptor (metadata). */
export const resolveProvider = (
	provider?: Provider | ProviderName | string | null,
): ProviderDescriptor | null => {
	if (!provider) return null;
	return getProviderDescriptor(typeof provider === 'object' ? provider.name : provider);
};

export const isServerProvider = (value: string): value is ProviderName => Boolean(getProviderDescriptor(value));

/**
 * Produces a normalized, storage-shape {@link Provider}. Merges a known
 * provider's defaults with any supplied fields (overrides win), always pinning a
 * canonical `name`. Descriptive metadata is intentionally not included.
 */
export const createProvider = (
	provider: ProviderName | Provider,
	overrides?: Partial<Omit<Provider, 'name'>>,
): Provider => {
	const base =
		getProviderTemplate(typeof provider === 'string' ? provider : provider.name) ??
		getProviderTemplate(DEFAULT_SERVER_PROVIDER);

	if (!base) {
		throw new Error('Default provider catalog is not configured.');
	}

	const incoming: Partial<Provider> = typeof provider === 'object' ? provider : {};
	const merged = { ...base, ...incoming, ...overrides };

	return {
		name: base.name,
		file: merged.file,
		download_url: merged.download_url,
		provider_version: merged.provider_version,
		minecraft_version: merged.minecraft_version,
		jdk_versions: merged.jdk_versions,
		supported_telemetry: merged.supported_telemetry,
		stable: merged.stable,
	};
};

export const isProxyProvider = (provider?: ProviderName | Provider | null): boolean =>
	resolveProvider(provider ?? null)?.kind === 'proxy';
