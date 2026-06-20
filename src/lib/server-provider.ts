import { DEFAULT_SERVER_PROVIDER } from './mserve-consts';
import {
	createDefaultProviderChecks,
	type Provider,
	type ProviderName,
	type ProviderTab,
} from './mserve-schema';

export type { ProviderName, TelemetryPolling } from './mserve-schema';

/** A {@link Provider} whose descriptive (version-independent) metadata is always
 *  present. Returned by the catalog lookups so consumers can rely on the fields. */
export type ProviderCatalogEntry = Provider & {
	aliases: string[];
	description: string;
	kind: 'plugin' | 'vanilla' | 'proxy';
	tab: ProviderTab;
	stable_name: string;
	unstable_name: string;
	supports_list_command: boolean;
	supports_tps_command: boolean;
	supports_version_command: boolean;
};

const titleCase = (value: string) =>
	value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;

/**
 * Static, version-independent metadata for each supported provider. The actual
 * downloadable versions (file, download_url, provider_version, minecraft_version,
 * jdk_versions, stable) are fetched live from the providers' official APIs by the
 * backend `list_provider_versions` / `resolve_provider_version` commands — see
 * {@link file://./jar-download-service.ts}. This catalog only holds the
 * descriptive metadata the UI needs regardless of version.
 */
export type ProviderDescriptor = {
	name: ProviderName;
	aliases: string[];
	description: string;
	kind: 'plugin' | 'vanilla' | 'proxy';
	tab: ProviderTab;
	stable_name: string;
	unstable_name: string;
	supports_list_command: boolean;
	supports_tps_command: boolean;
	supports_version_command: boolean;
	/** Sensible fallback when no live/exact requirement is known (manual flows). */
	default_jdk_versions: number[];
};

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
		supports_tps_command: false,
		supports_version_command: true,
		default_jdk_versions: [21],
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
	},
];

const descriptorToProvider = (descriptor: ProviderDescriptor): ProviderCatalogEntry => ({
	name: descriptor.name,
	file: '',
	download_url: undefined,
	provider_version: '',
	minecraft_version: descriptor.kind === 'proxy' ? 'proxy' : '',
	jdk_versions: [...descriptor.default_jdk_versions],
	supported_telemetry: createDefaultProviderChecks(),
	stable: true,
	aliases: [...descriptor.aliases],
	description: descriptor.description,
	kind: descriptor.kind,
	tab: descriptor.tab,
	stable_name: descriptor.stable_name,
	unstable_name: descriptor.unstable_name,
	supports_list_command: descriptor.supports_list_command,
	supports_tps_command: descriptor.supports_tps_command,
	supports_version_command: descriptor.supports_version_command,
});

const descriptorByName = new Map(PROVIDER_DESCRIPTORS.map((descriptor) => [descriptor.name, descriptor]));

const descriptorByAlias = new Map<string, ProviderDescriptor>();
for (const descriptor of PROVIDER_DESCRIPTORS) {
	descriptorByAlias.set(descriptor.name, descriptor);
	for (const alias of descriptor.aliases) {
		descriptorByAlias.set(alias.trim().toLowerCase(), descriptor);
	}
}

export const PROVIDERS: ProviderCatalogEntry[] = PROVIDER_DESCRIPTORS.map(descriptorToProvider);

export const PROVIDER_NAMES: ProviderName[] = PROVIDER_DESCRIPTORS.map((descriptor) => descriptor.name);

const providerByName = new Map(PROVIDERS.map((provider) => [provider.name, provider]));

export const getProviderDescriptor = (name?: ProviderName | string | null): ProviderDescriptor | null => {
	if (!name) return null;
	const key = name.trim().toLowerCase();
	return descriptorByName.get(key as ProviderName) ?? descriptorByAlias.get(key) ?? null;
};

export const getProviderDescriptorsForTab = (tab: ProviderTab): ProviderDescriptor[] =>
	PROVIDER_DESCRIPTORS.filter((descriptor) => descriptor.tab === tab);

export const getProviderDisplayName = (provider: ProviderName | string): string =>
	titleCase(provider.trim().toLowerCase());

export const getProviderByName = (name?: ProviderName | string | null): ProviderCatalogEntry | null => {
	if (!name) return null;
	const key = name.trim().toLowerCase() as ProviderName;
	return providerByName.get(key) ?? null;
};

export const resolveProvider = (
	provider?: Provider | ProviderName | string | null,
): ProviderCatalogEntry | null => {
	if (!provider) return null;
	if (typeof provider === 'object') {
		return getProviderByName(provider.name);
	}

	const descriptor = getProviderDescriptor(provider);
	return descriptor ? (getProviderByName(descriptor.name) ?? null) : null;
};

export const isServerProvider = (value: string): value is ProviderName => Boolean(getProviderByName(value));

export const createProvider = (
	provider: ProviderName | Provider,
	overrides?: Partial<Omit<Provider, 'name'>>,
): Provider => {
	const base =
		typeof provider === 'string'
			? (getProviderByName(provider) ?? getProviderByName(DEFAULT_SERVER_PROVIDER))
			: (getProviderByName(provider.name) ?? getProviderByName(DEFAULT_SERVER_PROVIDER));

	if (!base) {
		throw new Error('Default provider catalog is not configured.');
	}

	return {
		...base,
		...(typeof provider === 'object' ? provider : {}),
		...overrides,
		name: base.name,
	};
};

export const isProxyProvider = (provider?: ProviderName | Provider | null): boolean => {
	const resolved = resolveProvider(provider ?? null);
	return resolved?.kind === 'proxy';
};
