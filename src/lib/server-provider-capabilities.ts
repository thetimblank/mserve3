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
		supportsAutoAgreeEula:
			resolvedCatalog.kind === 'plugin' ||
			resolvedCatalog.kind === 'vanilla' ||
			resolvedCatalog.kind === 'modded',
	};
};

/** Lowercased jar file name without its directories or `.jar` extension, so
 *  folder names (`…/servers/…`, `…/Minecraft/…`) can't influence inference. */
const jarBaseName = (jarPath?: string | null): string =>
	(jarPath ?? '')
		.trim()
		.split(/[\\/]/)
		.pop()!
		.toLowerCase()
		.replace(/\.jar$/, '');

/** Vanilla's aliases (`server`, `minecraft`) also occur in other providers' jar
 *  names (`fabric-server-…`), so it is matched last, like the backend does. */
const INFERENCE_ORDER = [...getProviderDescriptors()].sort(
	(left, right) => Number(left.name === 'vanilla') - Number(right.name === 'vanilla'),
);

export const inferProviderFromJarPath = (jarPath?: string | null): ProviderName | null => {
	const name = jarBaseName(jarPath);
	if (!name) return null;

	const match = INFERENCE_ORDER.find((candidate) =>
		[candidate.name, ...candidate.aliases].some((hint) => name.includes(hint.toLowerCase())),
	);
	return match?.name ?? null;
};

/** The Minecraft version in a jar name (`paper-1.20.1-196.jar` → `1.20.1`). */
export const inferVersionFromJarPath = (jarPath?: string | null): string | null => {
	const name = jarBaseName(jarPath);
	if (!name) return null;

	const minecraftMatch = name.match(/\b1\.\d{1,2}(?:\.\d{1,2})?(?:-(?:pre|rc)\d+)?\b/);
	if (minecraftMatch) return minecraftMatch[0];

	const genericMatch = name.match(/\b\d+(?:\.\d+){1,3}\b/);
	return genericMatch?.[0] ?? null;
};
