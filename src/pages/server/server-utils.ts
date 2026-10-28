import { toast } from 'sonner';
import type { AutoBackupMode, Server } from '@/data/servers';
import type { Provider, ProviderName } from '@/lib/mserve-schema';
import { clampRamGb, formatHeapSize } from '@/lib/ram-utils';
import { createProvider, isProxyProvider } from '@/lib/server-provider';
import { getDurationParts } from '@/lib/utils';
import {
	DEFAULT_SLEEP_IDLE_MINUTES,
	DEFAULT_STORAGE_LIMIT_GB,
	DEFAULT_TELEMETRY_HOST,
	DEFAULT_TELEMETRY_PORT,
} from '@/lib/mserve-consts';
import type { ScannedBackupEntry, ServerSettingsForm, UpdateServerSettingsPayload } from './server-types';

export const toggleBackupMode = (
	current: AutoBackupMode[],
	mode: AutoBackupMode,
	enabled: boolean,
): AutoBackupMode[] =>
	enabled ? Array.from(new Set([...current, mode])) : current.filter((item) => item !== mode);

export const mapScannedBackups = (backups: ScannedBackupEntry[]) =>
	backups.map((backup) => ({
		directory: backup.directory,
		created_at: new Date(backup.createdAt ?? Date.now()),
		size: Math.max(0, Number(backup.size) || 0),
		name: backup.name ?? undefined,
		reason: backup.reason ?? undefined,
		locked: backup.locked === true,
		contents: backup.contents ?? undefined,
	}));

/** The settings form as it starts for a server: its saved settings, nothing pending. */
export const buildSettingsFormFromServer = (server: Server): ServerSettingsForm => ({
	ram: clampRamGb(server.ram),
	storage_limit: Math.max(1, Number(server.storage_limit) || DEFAULT_STORAGE_LIMIT_GB),
	auto_backup: server.auto_backup,
	auto_backup_interval: Math.max(1, server.auto_backup_interval),
	auto_restart: server.auto_restart,
	sleep_enabled: server.sleep_enabled,
	sleep_idle_minutes: Math.max(1, Number(server.sleep_idle_minutes) || DEFAULT_SLEEP_IDLE_MINUTES),
	sleep_motd: server.sleep_motd,
	custom_flags: server.custom_flags,
	java_installation: server.java_installation ?? '',
	provider: createProvider(server.provider, { file: server.file }),
	telemetry_host: server.telemetry_host ?? DEFAULT_TELEMETRY_HOST,
	telemetry_port: Math.max(1, Number(server.telemetry_port) || DEFAULT_TELEMETRY_PORT),
	jar_swap_path: '',
	new_directory: server.directory,
});

export const buildUpdateServerSettingsPayload = (
	directory: string,
	settingsForm: ServerSettingsForm,
): UpdateServerSettingsPayload => ({
	directory,
	ram: clampRamGb(settingsForm.ram),
	storage_limit: Math.max(1, Number(settingsForm.storage_limit) || DEFAULT_STORAGE_LIMIT_GB),
	auto_backup: settingsForm.auto_backup,
	auto_backup_interval: Math.max(1, Number(settingsForm.auto_backup_interval) || 1),
	auto_restart: settingsForm.auto_restart,
	sleep_enabled: settingsForm.sleep_enabled,
	sleep_idle_minutes: Math.max(1, Number(settingsForm.sleep_idle_minutes) || DEFAULT_SLEEP_IDLE_MINUTES),
	sleep_motd: settingsForm.sleep_motd,
	custom_flags: settingsForm.custom_flags,
	java_installation: settingsForm.java_installation.trim() || undefined,
	provider: settingsForm.provider,
	telemetry_host: settingsForm.telemetry_host.trim() || undefined,
	telemetry_port: Math.max(1, Number(settingsForm.telemetry_port) || DEFAULT_TELEMETRY_PORT),
	jar_swap_path: settingsForm.jar_swap_path.trim() || undefined,
	new_directory: settingsForm.new_directory.trim() || undefined,
});

export const parseCustomFlagsInput = (input: string): string[] => {
	const deduped = new Set<string>();

	for (const rawLine of input.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (!trimmed) continue;
		deduped.add(trimmed);
	}

	return Array.from(deduped);
};

export const formatCustomFlagsInput = (custom_flags: string[] | undefined): string =>
	(custom_flags ?? []).filter(Boolean).join('\n');

export const buildServerRunCommandPreview = (config: {
	ram?: number;
	file?: string;
	custom_flags?: string[];
	/** The already-resolved java executable (from resolveServerJavaExecutable). */
	java_executable?: string;
}): string => {
	const heap = formatHeapSize(config.ram ?? 4);
	const resolvedFile = config.file?.trim() || 'server.jar';
	const resolvedJavaInstallation = config.java_executable?.trim() || '<no Java resolved>';
	const resolvedCustomFlags = (config.custom_flags ?? []).map((flag) => flag.trim()).filter(Boolean);

	const args = [`-Xms${heap}`, `-Xmx${heap}`, '-jar', resolvedFile, ...resolvedCustomFlags];

	return `${resolvedJavaInstallation} ${args.join(' ')}`;
};

export const resolveNewDirectory = (payload: UpdateServerSettingsPayload, currentDirectory: string) => {
	const trimmed = payload.new_directory?.trim();
	if (!trimmed || trimmed === currentDirectory) {
		return undefined;
	}
	return trimmed;
};

/** Prefix of the backend error when a backup wouldn't fit the storage limit. */
export const BACKUP_STORAGE_LIMIT_ERROR_PREFIX = 'Backup storage limit exceeded';

/** Tells the user how many old backups retention removed (nothing when none). */
export const notifyDeletedBackups = (count: number) => {
	if (count < 1) return;
	toast.info(
		count === 1
			? 'Removed 1 old backup per your retention settings.'
			: `Removed ${count} old backups per your retention settings.`,
	);
};

/**
 * Console commands that shut a server down, per provider. Mirrors
 * `shutdown_commands_for` in `src-tauri/src/app/commands/runtime.rs`:
 * BungeeCord/Waterfall only know `end`; Velocity's `shutdown` also answers to
 * `end` and `stop`.
 */
const shutdownCommandsFor = (providerName: string): string[] => {
	const name = providerName.toLowerCase();
	if (name.includes('velocity')) return ['shutdown', 'end', 'stop'];
	if (name.includes('bungee') || name.includes('waterfall')) return ['end'];
	return ['stop'];
};

/**
 * True when a console command shuts the server down. Proxies take a trailing
 * reason (`end <message>`); game servers only a bare `stop`.
 */
export const isStopCommand = (command: string, provider?: Provider | ProviderName | null) => {
	const normalized = command.replace(/^\//, '').trim().toLowerCase();
	const word = isProxyProvider(provider) ? (normalized.split(/\s+/)[0] ?? '') : normalized;
	const providerName = (typeof provider === 'object' ? provider?.name : provider) ?? '';
	return shutdownCommandsFor(providerName).includes(word);
};

export const getBackupNameFromPath = (backupDirectory: string) =>
	backupDirectory.split(/[\\/]/).pop() || 'backup';

/** Detailed uptime for the overview panel (`2d 3h 15m`, `4h 2m 9s`, `5m 30s`).
 *  The compact card variant is `formatUptime` in `lib/utils`. */
export const formatDetailedUptime = (uptime: Date) => {
	const diff = Math.max(0, Date.now() - uptime.getTime());
	const { days, hours, minutes, seconds } = getDurationParts(diff);

	if (days > 0) return `${days}d ${hours}h ${minutes}m`;
	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	return `${minutes}m ${seconds}s`;
};
