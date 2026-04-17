import { invoke } from '@tauri-apps/api/core';

export type AutoBackupMode = 'interval' | 'on_close' | 'on_start';

export type ServerSetupFormData = {
	directory: string;
	createDirectoryIfMissing: boolean;
	file: string;
	ram: number;
	storageLimit: number;
	autoRestart: boolean;
	autoBackup: AutoBackupMode[];
	autoBackupInterval: number;
	autoAgreeEula: boolean;
	javaInstallation: string;
	provider: string;
	version: string;
};

export const createDefaultServerSetupForm = (): ServerSetupFormData => ({
	directory: '',
	createDirectoryIfMissing: true,
	file: '',
	ram: 3,
	storageLimit: 200,
	autoRestart: false,
	autoBackup: [],
	autoBackupInterval: 120,
	autoAgreeEula: true,
	javaInstallation: '',
	provider: '',
	version: '',
});

export type SyncedMserveConfig = {
	id: string;
	file: string;
	ram: number;
	storage_limit: number;
	auto_backup: AutoBackupMode[];
	auto_backup_interval: number;
	auto_restart: boolean;
	custom_flags: string[];
	java_installation?: string;
	provider?: string;
	version?: string;
	created_at: string;
};

export type SyncMserveJsonResult = {
	status: 'synced' | 'needs_setup';
	message: string;
	config?: SyncedMserveConfig;
	updated: boolean;
};

export type RepairMserveJsonPayload = Pick<
	ServerSetupFormData,
	| 'directory'
	| 'file'
	| 'ram'
	| 'storageLimit'
	| 'autoRestart'
	| 'autoBackup'
	| 'autoBackupInterval'
	| 'javaInstallation'
> &
	Partial<Pick<ServerSetupFormData, 'createDirectoryIfMissing' | 'autoAgreeEula'>> & {
		customFlags: string[];
		provider?: string;
		version?: string;
	};

export type PromptMserveRepairOptions = RepairMserveJsonPayload;

export const syncServerMserveJson = (directory: string) =>
	invoke<SyncMserveJsonResult>('sync_server_mserve_json', { directory });

export const repairServerMserveJson = (payload: RepairMserveJsonPayload) =>
	invoke<SyncMserveJsonResult>('repair_server_mserve_json', { payload });
