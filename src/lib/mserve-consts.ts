import type { ProviderName } from './mserve-schema';

export const TELEMETRY_POLLING = ['list', 'tps', 'version', 'online', 'ram', 'cpu', 'provider'] as const;

export const DEFAULT_SERVER_PROVIDER: ProviderName = 'vanilla';

// Config defaults mirrored from the Rust side (`mserve_config.rs`).
export const DEFAULT_RAM_GB = 4;
export const DEFAULT_STORAGE_LIMIT_GB = 50;
/** The backup limit every server got before limits were sized from the drive. */
export const LEGACY_DEFAULT_STORAGE_LIMIT_GB = 200;
export const DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES = 120;
/** DurationPicker chips for the backup interval. Includes the 2h default so it opens on a chip. */
export const AUTO_BACKUP_INTERVAL_PRESETS_MINUTES: readonly number[] = [30, 60, 120, 360, 720, 1440];
export const DEFAULT_SLEEP_MOTD = '§eSleeping. §7Join to wake this server';
export const DEFAULT_SLEEP_IDLE_MINUTES = 15;
/** DurationPicker chips for the sleep idle timeout. Includes the 15m default so it opens on a chip. */
export const SLEEP_IDLE_PRESETS_MINUTES: readonly number[] = [5, 10, 15, 30, 60, 120];
export const DEFAULT_TELEMETRY_HOST = '127.0.0.1';
export const DEFAULT_TELEMETRY_PORT = 25565;
