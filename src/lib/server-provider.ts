export const providerOptions = [
	{ value: 'paper', label: 'Paper' },
	{ value: 'folia', label: 'Folia' },
	{ value: 'spigot', label: 'Spigot' },
	{ value: 'vanilla', label: 'Vanilla' },
	{ value: 'velocity', label: 'Velocity' },
	{ value: 'bungeecord', label: 'BungeeCord' },
] as const;

export type ServerProvider = (typeof providerOptions)[number]['value'];

export const DEFAULT_SERVER_PROVIDER: ServerProvider = 'vanilla';

const SERVER_PROVIDER_VALUES = new Set<ServerProvider>(providerOptions.map((option) => option.value));

const PROVIDER_ALIASES: Record<string, ServerProvider> = {
	paper: 'paper',
	folia: 'folia',
	spigot: 'spigot',
	vanilla: 'vanilla',
	mojang: 'vanilla',
	minecraft_server: 'vanilla',
	velocity: 'velocity',
	bungeecord: 'bungeecord',
	waterfall: 'bungeecord',
};

export const isServerProvider = (value: string): value is ServerProvider =>
	SERVER_PROVIDER_VALUES.has(value as ServerProvider);

export const normalizeServerProvider = (provider?: string | null): ServerProvider => {
	const normalized = provider?.trim().toLowerCase() ?? '';
	if (!normalized) return DEFAULT_SERVER_PROVIDER;

	return PROVIDER_ALIASES[normalized] ?? DEFAULT_SERVER_PROVIDER;
};

export const isProxyProvider = (provider: ServerProvider): boolean =>
	provider === 'velocity' || provider === 'bungeecord';

export const getProviderLabel = (provider: ServerProvider): string =>
	providerOptions.find((option) => option.value === provider)?.label ?? 'Vanilla';
