import type { Server } from '@/data/servers';
import type { ServerSetupFormData, SyncedMserveConfig } from '@/lib/mserve-sync';
import { createDefaultProviderChecks, normalizeProviderChecks } from '@/lib/mserve-schema';

type InitServerResult = {
	id: string;
	file: string;
	directory: string;
};

export const getServerNameFromDirectory = (directory: string) => {
	const segments = directory.split(/[\\/]/).filter(Boolean);
	return segments[segments.length - 1] || 'Server';
};

const buildServerShell = (
	directory: string,
): Omit<
	Server,
	| 'id'
	| 'file'
	| 'ram'
	| 'storage_limit'
	| 'auto_backup'
	| 'auto_backup_interval'
	| 'auto_restart'
	| 'java_installation'
	| 'custom_flags'
	| 'provider'
	| 'version'
	| 'provider_checks'
	| 'created_at'
> => ({
	name: getServerNameFromDirectory(directory),
	directory,
	status: 'offline',
	backups: [],
	datapacks: [],
	worlds: [],
	plugins: [],
	stats: {
		players: 0,
		capacity: 20,
		tps: 0,
		uptime: null,
		worlds_size_bytes: 0,
		backups_size_bytes: 0,
	},
});

export const buildCreatedServer = (form: ServerSetupFormData, result: InitServerResult): Server => ({
	...buildServerShell(result.directory),
	id: result.id,
	file: result.file,
	ram: Math.max(1, Number(form.ram) || 1),
	storage_limit: Math.max(1, Number(form.storage_limit) || 200),
	auto_backup: form.auto_backup,
	auto_backup_interval: Math.max(1, Number(form.auto_backup_interval) || 120),
	auto_restart: form.auto_restart,
	java_installation: form.java_installation.trim() || undefined,
	custom_flags: [],
	provider: form.provider.trim() || undefined,
	version: form.version.trim() || undefined,
	provider_checks: createDefaultProviderChecks(),
	created_at: new Date().toISOString(),
});

export const buildImportedServer = (result: InitServerResult, config: SyncedMserveConfig): Server => ({
	...buildServerShell(result.directory),
	id: config.id,
	file: config.file,
	ram: config.ram,
	storage_limit: Math.max(1, Number(config.storage_limit) || 200),
	auto_backup: config.auto_backup,
	auto_backup_interval: config.auto_backup_interval,
	auto_restart: config.auto_restart,
	java_installation: config.java_installation,
	custom_flags: config.custom_flags,
	provider: config.provider,
	version: config.version,
	provider_checks: normalizeProviderChecks(config.provider_checks),
	created_at: config.created_at,
});
