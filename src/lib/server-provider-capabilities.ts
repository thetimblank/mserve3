import { DEFAULT_SERVER_PROVIDER } from './mserve-consts';
import { type Provider, type ProviderKind, type ProviderName, type TelemetryKey } from './mserve-schema';
import { createProvider, getProviderDescriptor, getProviderDescriptors, resolveProvider } from './server-provider';

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

const resolveTelemetrySupport = (provider: Provider, key: TelemetryKey) =>
	provider.supported_telemetry?.includes(key) ?? false;

export const resolveProviderKind = (
	provider?: Provider | ProviderName | string | null,
): ProviderKind => {
	const resolved = resolveProvider(provider ?? null);
	return resolved?.kind ?? 'unknown';
};

export const getDefaultProviderCommandSupport = (
	provider: ProviderName = DEFAULT_SERVER_PROVIDER,
): ProviderCommandSupport => {
	const descriptor = getProviderDescriptor(provider) ?? getProviderDescriptor(DEFAULT_SERVER_PROVIDER);
	if (!descriptor) {
		return {
			supportsListCommand: true,
			supportsTpsCommand: false,
			supportsVersionCommand: true,
		};
	}

	return {
		supportsListCommand: descriptor.supports_list_command,
		supportsTpsCommand: descriptor.supports_tps_command,
		supportsVersionCommand: descriptor.supports_version_command,
	};
};

export const getServerProviderCapabilities = (
	provider?: Provider | ProviderName | string | null,
): ServerProviderCapabilities => {
	const resolvedCatalog = resolveProvider(provider ?? null) ?? getProviderDescriptor(DEFAULT_SERVER_PROVIDER);
	if (!resolvedCatalog) {
		return {
			kind: 'unknown',
			supportsListCommand: false,
			supportsTpsCommand: false,
			supportsVersionCommand: false,
			supportsAutoAgreeEula: false,
		};
	}

	const resolvedProvider =
		typeof provider === 'object' && provider !== null
			? provider
			: createProvider(resolvedCatalog.name);

	return {
		kind: resolvedCatalog.kind,
		supportsListCommand:
			resolvedCatalog.supports_list_command && resolveTelemetrySupport(resolvedProvider, 'list'),
		supportsTpsCommand:
			resolvedCatalog.supports_tps_command && resolveTelemetrySupport(resolvedProvider, 'tps'),
		supportsVersionCommand:
			resolvedCatalog.supports_version_command && resolveTelemetrySupport(resolvedProvider, 'version'),
		supportsAutoAgreeEula: resolvedCatalog.kind === 'plugin' || resolvedCatalog.kind === 'vanilla',
	};
};

export const inferProviderFromJarPath = (jarPath?: string | null): ProviderName | null => {
	const normalized = jarPath?.trim().toLowerCase();
	if (!normalized) return null;

	for (const candidate of getProviderDescriptors()) {
		if (
			[candidate.name, ...candidate.aliases].some((hint) => {
				const token = hint.trim().toLowerCase();
				return token.length > 0 && normalized.includes(token);
			})
		) {
			return candidate.name;
		}
	}

	return null;
};

export const inferVersionFromJarPath = (jarPath?: string | null): string | null => {
	const normalized = jarPath?.trim().toLowerCase();
	if (!normalized) return null;

	const minecraftMatch = normalized.match(/\b1\.\d{1,2}(?:\.\d{1,2})?(?:-[a-z0-9.-]+)?\b/);
	if (minecraftMatch?.[0]) {
		return minecraftMatch[0];
	}

	const genericMatch = normalized.match(/\b\d+(?:\.\d+){1,3}(?:-[a-z0-9.-]+)?\b/);
	return genericMatch?.[0] ?? null;
};
