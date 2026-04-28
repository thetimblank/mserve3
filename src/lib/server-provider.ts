import { DEFAULT_SERVER_PROVIDER } from './mserve-consts';
import {
	createDefaultProviderChecks,
	type Provider,
	type ProviderName,
	type ProviderTab,
} from './mserve-schema';

export type { ProviderName, TelemetryPolling } from './mserve-schema';

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

const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
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
		file: 'paper-1.21.11-130.jar',
		download_url:
			'https://fill-data.papermc.io/v1/objects/25eb85bd8415195ce4bc188e1939e0c7cef77fb51d26d4e766407ee922561097/paper-1.21.11-130.jar',
		provider_version: '130',
		minecraft_version: '1.21.11',
		jdk_versions: [21],
		supported_telemetry: createDefaultProviderChecks(),
		stable: true,
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
		file: 'folia-1.21.11-14.jar',
		download_url:
			'https://fill-data.papermc.io/v1/objects/f52c408490a0225611e67907a3ca19f7e6da2c6bc899e715d5f46844e7103c39/folia-1.21.11-14.jar',
		provider_version: '14',
		minecraft_version: '1.21.11',
		jdk_versions: [21],
		supported_telemetry: createDefaultProviderChecks(),
		stable: true,
	},
	// {
	// 	name: 'spigot',
	// 	aliases: ['spigot', 'bukkit', 'craftbukkit'],
	// 	description: 'Classic Bukkit-compatible server software for plugin ecosystems',
	// 	kind: 'plugin',
	// 	tab: 'plugin',
	// 	stable_name: 'Stable',
	// 	unstable_name: 'Unstable',
	// 	supports_list_command: true,
	// 	supports_tps_command: false,
	// 	supports_version_command: true,
	// 	file: 'spigot-1.21.1.jar',
	// 	provider_version: 'latest',
	// 	minecraft_version: '1.21.1',
	// 	jdk_versions: [21],
	// 	supported_telemetry: createDefaultProviderChecks(),
	// 	stable: true,
	// },
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
		file: 'vanilla-1.21.11.jar',
		download_url:
			'https://piston-data.mojang.com/v1/objects/97ccd4c0ed3f81bbb7bfacddd1090b0c56f9bc51/server.jar',
		provider_version: 'release',
		minecraft_version: '1.21.11',
		jdk_versions: [21],
		supported_telemetry: createDefaultProviderChecks(),
		stable: true,
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
		file: 'velocity-3.5.0-SNAPSHOT-592.jar',
		download_url:
			'https://fill-data.papermc.io/v1/objects/495f8ec5717edef9975383976c0b3e497a5509a9115d04c07fce16de11b6a72a/velocity-3.5.0-SNAPSHOT-592.jar',
		provider_version: '3.5.0-SNAPSHOT-592',
		minecraft_version: 'proxy',
		jdk_versions: [17, 21],
		supported_telemetry: createDefaultProviderChecks(),
		stable: true,
	},
	// {
	// 	name: 'bungeecord',
	// 	aliases: ['bungeecord', 'bungee', 'waterfall'],
	// 	description: 'Legacy proxy option used in older multi-server setups',
	// 	kind: 'proxy',
	// 	tab: 'proxies',
	// 	stable_name: 'Stable',
	// 	unstable_name: 'Unstable',
	// 	supports_list_command: true,
	// 	supports_tps_command: false,
	// 	supports_version_command: true,
	// 	file: 'bungeecord-latest.jar',
	// 	provider_version: 'latest',
	// 	minecraft_version: 'proxy',
	// 	jdk_versions: [17, 21],
	// 	supported_telemetry: createDefaultProviderChecks(),
	// 	stable: true,
	// },
];

const providerByName = new Map(PROVIDER_CATALOG.map((provider) => [provider.name, provider]));

const providerByAlias = new Map<string, ProviderCatalogEntry>();
for (const provider of PROVIDER_CATALOG) {
	providerByAlias.set(provider.name, provider);
	for (const alias of provider.aliases) {
		providerByAlias.set(alias.trim().toLowerCase(), provider);
	}
}

export const PROVIDERS: ProviderCatalogEntry[] = PROVIDER_CATALOG.map((provider) => ({ ...provider }));

export const PROVIDER_NAMES: ProviderName[] = PROVIDERS.map((provider) => provider.name);

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

	const key = provider.trim().toLowerCase();
	if (!key) return null;
	return providerByAlias.get(key) ?? null;
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
