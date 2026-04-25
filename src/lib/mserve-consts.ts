import type { ProviderName } from './mserve-schema';

export const TELEMETRY_POLLING = ['list', 'tps', 'version', 'online', 'ram', 'cpu', 'provider'] as const;

export const DEFAULT_SERVER_PROVIDER: ProviderName = 'vanilla';
