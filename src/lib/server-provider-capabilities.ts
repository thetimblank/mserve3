export type ProviderKind = 'plugin' | 'vanilla' | 'proxy' | 'unknown';

export type ServerProviderCapabilities = {
	kind: ProviderKind;
	supportsListCommand: boolean;
	supportsTpsCommand: boolean;
	supportsVersionCommand: boolean;
	supportsAutoAgreeEula: boolean;
};

const normalizeProvider = (provider?: string): string => provider?.trim().toLowerCase() ?? '';

const JAR_PROVIDER_HINTS: Array<{ tokens: string[]; provider: string }> = [
	{ tokens: ['paper', 'folia'], provider: 'paper' },
	{ tokens: ['spigot'], provider: 'spigot' },
	{ tokens: ['purpur'], provider: 'purpur' },
	{ tokens: ['fabric'], provider: 'fabric' },
	{ tokens: ['forge', 'neoforge'], provider: 'forge' },
	{ tokens: ['velocity'], provider: 'velocity' },
	{ tokens: ['bungeecord', 'waterfall'], provider: 'bungeecord' },
	{ tokens: ['sponge'], provider: 'sponge' },
	{ tokens: ['quilt'], provider: 'quilt' },
	{ tokens: ['mojang', 'vanilla', 'minecraft_server'], provider: 'vanilla' },
];

const basenameWithoutExtension = (pathOrFile: string): string => {
	const normalized = pathOrFile.replace(/\\/g, '/');
	const name = normalized.split('/').pop() ?? normalized;
	return name
		.replace(/\.jar$/i, '')
		.trim()
		.toLowerCase();
};

export const inferProviderFromJarPath = (pathOrFile: string): string | null => {
	const base = basenameWithoutExtension(pathOrFile);
	if (!base) return null;

	for (const hint of JAR_PROVIDER_HINTS) {
		if (hint.tokens.some((token) => base.includes(token))) {
			return hint.provider;
		}
	}

	return null;
};

export const inferVersionFromJarPath = (pathOrFile: string): string | null => {
	const base = basenameWithoutExtension(pathOrFile);
	if (!base) return null;

	const match = base.match(/(?:^|[^\d])(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)(?:[^\d]|$)/);
	return match?.[1] ?? null;
};

export const resolveProviderKind = (provider?: string): ProviderKind => {
	const normalized = normalizeProvider(provider);
	if (!normalized) return 'unknown';

	if (normalized.includes('paper') || normalized.includes('folia') || normalized.includes('spigot')) {
		return 'plugin';
	}

	if (normalized.includes('vanilla') || normalized.includes('mojang')) {
		return 'vanilla';
	}

	if (normalized.includes('velocity') || normalized.includes('bungeecord') || normalized.includes('proxy')) {
		return 'proxy';
	}

	return 'unknown';
};

export const getServerProviderCapabilities = (provider?: string): ServerProviderCapabilities => {
	const normalized = normalizeProvider(provider);
	const kind = resolveProviderKind(provider);

	const supportsListCommand = kind !== 'proxy';
	const supportsTpsCommand = normalized.includes('paper') || normalized.includes('folia');
	const supportsVersionCommand = kind === 'plugin';
	const supportsAutoAgreeEula = kind === 'plugin' || kind === 'vanilla';

	return {
		kind,
		supportsListCommand,
		supportsTpsCommand,
		supportsVersionCommand,
		supportsAutoAgreeEula,
	};
};
