import type { AutoBackupMode, Server as MserveServer } from '@/data/servers';
import type { Provider } from '@/lib/mserve-schema';

export type ServerOutputEvent = {
	directory: string;
	stream: string;
	line: string;
};

export type ScannedBackupEntry = {
	directory: string;
	created_at?: string;
	size?: number;
};

export type CreateServerBackupResult = {
	backup: ScannedBackupEntry;
	deletedBackupsCount: number;
};

export type RestoreServerBackupResult = {
	deletedBackupsCount: number;
};

export type ScanServerContentsResult = {
	plugins: MserveServer['plugins'];
	worlds: MserveServer['worlds'];
	datapacks: MserveServer['datapacks'];
	backups: ScannedBackupEntry[];
	worldsSizeBytes: number;
	backupsSizeBytes: number;
};

export type RuntimeStatusResult = {
	running: boolean;
	exitCode: number | null;
};

export type ServerTelemetryResult = {
	online: boolean;
	playersOnline: number | null;
	playersMax: number | null;
	serverVersion: string | null;
	providerVersion: string | null;
	tps: number | null;
	ramUsed: number | null;
	cpuUsed: number | null;
	uptime: string | null;
};

export type UpdateServerSettingsPayload = {
	directory: string;
	ram: number;
	storage_limit: number;
	auto_backup: AutoBackupMode[];
	auto_backup_interval: number;
	auto_restart: boolean;
	custom_flags: string[];
	java_installation?: string;
	provider: Provider;
	telemetry_host?: string;
	telemetry_port?: number;
	jar_swap_path?: string;
	new_directory?: string;
};

export type UpdateServerSettingsResult = {
	directory: string;
	file: string;
	provider: Provider;
	telemetry_host: string;
	telemetry_port: number;
};

export type ServerContentTab = 'plugins' | 'worlds' | 'datapacks' | 'backups' | 'settings';

export type ServerSettingsForm = {
	ram: number;
	storage_limit: number;
	auto_backup: AutoBackupMode[];
	auto_backup_interval: number;
	auto_restart: boolean;
	custom_flags: string[];
	java_installation: string;
	provider: Provider;
	telemetry_host: string;
	telemetry_port: number;
	jar_swap_path: string;
	new_directory: string;
};

