import type { ProviderName } from './mserve-schema';

export const TELEMETRY_POLLING = ['list', 'tps', 'version', 'online', 'ram', 'cpu', 'provider'] as const;

export const DEFAULT_SERVER_PROVIDER: ProviderName = 'vanilla';

// Config defaults mirrored from the Rust side (`mserve_config.rs`).
export const DEFAULT_SLEEP_MOTD = '§eSleeping §7— join to wake this server';
export const DEFAULT_SLEEP_IDLE_MINUTES = 15;
export const DEFAULT_TELEMETRY_HOST = '127.0.0.1';
export const DEFAULT_TELEMETRY_PORT = 25565;
