import type { ProviderChecks } from '@/lib/mserve-schema';
import {
	DEFAULT_SERVER_PROVIDER,
	type ServerProvider,
	isProxyProvider,
	normalizeServerProvider,
} from '@/lib/server-provider';

export type ProviderKind = 'plugin' | 'vanilla' | 'proxy' | 'unknown';

export type ServerProviderCapabilities = {
	kind: ProviderKind;
	supportsListCommand: boolean;
	supportsTpsCommand: boolean;
	supportsVersionCommand: boolean;
	supportsAutoAgreeEula: boolean;
};

type ProviderCommandSupport = Pick<
	ServerProviderCapabilities,
	'supportsListCommand' | 'supportsTpsCommand' | 'supportsVersionCommand'
>;

const JAR_PROVIDER_HINTS: Array<{ tokens: string[]; provider: ServerProvider }> = [
	{ tokens: ['paper'], provider: 'paper' },
	{ tokens: ['folia'], provider: 'folia' },
	{ tokens: ['spigot'], provider: 'spigot' },
	{ tokens: ['velocity'], provider: 'velocity' },
	{ tokens: ['bungeecord', 'waterfall'], provider: 'bungeecord' },
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

export const inferProviderFromJarPath = (pathOrFile: string): ServerProvider | null => {
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

export const resolveProviderKind = (provider?: ServerProvider | null): ProviderKind => {
	if (!provider) return 'unknown';

	if (provider === 'paper' || provider === 'folia' || provider === 'spigot') {
		return 'plugin';
	}

	if (provider === 'vanilla') {
		return 'vanilla';
	}

	if (isProxyProvider(provider)) {
		return 'proxy';
	}

	return 'unknown';
};

export const getDefaultProviderCommandSupport = (
	provider: ServerProvider = DEFAULT_SERVER_PROVIDER,
): ProviderCommandSupport => {
	return {
		supportsListCommand: true,
		supportsTpsCommand: provider === 'paper' || provider === 'folia',
		supportsVersionCommand: true,
	};
};

const applyCommandOverride = (supported: boolean, override?: boolean) => supported && override !== false;

export const getServerProviderCapabilities = (
	provider?: string,
	providerChecks?: Partial<ProviderChecks> | null,
): ServerProviderCapabilities => {
	const normalizedProvider = provider ? normalizeServerProvider(provider) : undefined;
	const kind = resolveProviderKind(normalizedProvider);
	const baseSupport = getDefaultProviderCommandSupport(normalizedProvider ?? DEFAULT_SERVER_PROVIDER);

	const supportsListCommand = applyCommandOverride(
		baseSupport.supportsListCommand,
		providerChecks?.list_polling,
	);
	const supportsTpsCommand = applyCommandOverride(
		baseSupport.supportsTpsCommand,
		providerChecks?.tps_polling,
	);
	const supportsVersionCommand = applyCommandOverride(
		baseSupport.supportsVersionCommand,
		providerChecks?.version_polling,
	);
	const supportsAutoAgreeEula = kind === 'plugin' || kind === 'vanilla';

	return {
		kind,
		supportsListCommand,
		supportsTpsCommand,
		supportsVersionCommand,
		supportsAutoAgreeEula,
	};
};
