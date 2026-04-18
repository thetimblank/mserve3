import type { AutoBackupMode } from '@/data/servers';
import { normalizeProviderChecks } from '@/lib/mserve-schema';
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
		created_at: new Date(backup.created_at ?? Date.now()),
	}));

export const buildUpdateServerSettingsPayload = (
	directory: string,
	settingsForm: ServerSettingsForm,
): UpdateServerSettingsPayload => ({
	directory,
	ram: Math.max(1, Number(settingsForm.ram) || 1),
	storage_limit: Math.max(1, Number(settingsForm.storage_limit) || 200),
	auto_backup: settingsForm.auto_backup,
	auto_backup_interval: Math.max(1, Number(settingsForm.auto_backup_interval) || 1),
	auto_restart: settingsForm.auto_restart,
	custom_flags: settingsForm.custom_flags,
	java_installation: settingsForm.java_installation.trim() || undefined,
	provider: settingsForm.provider.trim() || undefined,
	version: settingsForm.version.trim() || undefined,
	provider_checks: normalizeProviderChecks(settingsForm.provider_checks),
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
	java_installation?: string;
	global_java_installation?: string;
}): string => {
	const resolvedRam = Math.max(1, config.ram ?? 4);
	const resolvedFile = config.file?.trim() || 'server.jar';
	const resolvedJavaInstallation =
		config.java_installation?.trim() || config.global_java_installation?.trim() || 'java';
	const resolvedCustomFlags = (config.custom_flags ?? []).map((flag) => flag.trim()).filter(Boolean);

	const args = [`-Xms${resolvedRam}G`, `-Xmx${resolvedRam}G`, '-jar', resolvedFile, ...resolvedCustomFlags];

	return `${resolvedJavaInstallation} ${args.join(' ')}`;
};

export const resolveNewDirectory = (payload: UpdateServerSettingsPayload, currentDirectory: string) => {
	const trimmed = payload.new_directory?.trim();
	if (!trimmed || trimmed === currentDirectory) {
		return undefined;
	}
	return trimmed;
};

export const didRequestStop = (
	stopRequested: boolean,
	restartRequested: boolean,
	manualStopRequested: boolean,
) => stopRequested || restartRequested || manualStopRequested;

export const makeCloseBackupKey = (serverId: string, exitCode: number | null) =>
	`${serverId}:${exitCode ?? 'none'}`;

export const isStopCommand = (command: string) => command.replace(/^\//, '').trim().toLowerCase() === 'stop';

export const getBackupNameFromPath = (backupDirectory: string) =>
	backupDirectory.split(/[\\/]/).pop() || 'backup';

export const formatUptime = (uptime: Date) => {
	const now = new Date();
	const diff = now.getTime() - uptime.getTime();
	const days = Math.floor(diff / (1000 * 60 * 60 * 24));
	const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
	const minutes = Math.floor((diff / (1000 * 60)) % 60);
	const seconds = Math.floor((diff / 1000) % 60);

	if (days > 0) return `${days}d ${hours}h ${seconds}s`;
	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (minutes < 0) return `Just started ${seconds}s ago`;
	return `${minutes}m ${seconds}s`;
};
