import type { Server } from '@/data/servers';
import type { ServerSetupFormData, SyncedMserveConfig } from '@/lib/mserve-sync';
import { DEFAULT_SERVER_PROVIDER } from '@/lib/mserve-consts';
import { createProvider } from '@/lib/server-provider';

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
	| 'telemetry_host'
	| 'telemetry_port'
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
		online: false,
		players_online: null,
		players_max: null,
		server_version: null,
		provider_version: null,
		tps: null,
		ram_used: null,
		cpu_used: null,
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
	provider: createProvider(form.provider ?? DEFAULT_SERVER_PROVIDER, { file: result.file }),
	telemetry_host: '127.0.0.1',
	telemetry_port: 25565,
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
	provider: createProvider(config.provider, { file: config.file }),
	telemetry_host: config.telemetry_host,
	telemetry_port: config.telemetry_port,
	created_at: config.created_at,
});
