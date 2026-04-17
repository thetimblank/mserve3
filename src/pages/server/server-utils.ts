import type { AutoBackupMode } from '@/data/servers';
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
		created_at: new Date(backup.created_at ?? backup.created_at ?? Date.now()),
	}));

export const buildUpdateServerSettingsPayload = (
	directory: string,
	settingsForm: ServerSettingsForm,
): UpdateServerSettingsPayload => ({
	directory,
	ram: Math.max(1, Number(settingsForm.ram) || 1),
	storageLimit: Math.max(1, Number(settingsForm.storageLimit) || 200),
	autoBackup: settingsForm.autoBackup,
	autoBackupInterval: Math.max(1, Number(settingsForm.autoBackupInterval) || 1),
	autoRestart: settingsForm.autoRestart,
	customFlags: settingsForm.customFlags,
	javaInstallation: settingsForm.javaInstallation.trim() || undefined,
	jarSwapPath: settingsForm.jarSwapPath.trim() || undefined,
	newDirectory: settingsForm.newDirectory.trim() || undefined,
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

export const formatCustomFlagsInput = (customFlags: string[] | undefined): string =>
	(customFlags ?? []).filter(Boolean).join('\n');

export const buildServerRunCommandPreview = (config: {
	ram?: number;
	file?: string;
	customFlags?: string[];
	javaInstallation?: string;
	globalJavaInstallation?: string;
}): string => {
	const resolvedRam = Math.max(1, config.ram ?? 3);
	const resolvedFile = config.file?.trim() || 'server.jar';
	const resolvedJavaInstallation =
		config.javaInstallation?.trim() || config.globalJavaInstallation?.trim() || 'java';
	const resolvedCustomFlags = (config.customFlags ?? []).map((flag) => flag.trim()).filter(Boolean);

	const args = [`-Xms${resolvedRam}G`, `-Xmx${resolvedRam}G`, '-jar', resolvedFile, ...resolvedCustomFlags];

	return `${resolvedJavaInstallation} ${args.join(' ')}`;
};

export const resolveNewDirectory = (payload: UpdateServerSettingsPayload, currentDirectory: string) => {
	const trimmed = payload.newDirectory?.trim();
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
