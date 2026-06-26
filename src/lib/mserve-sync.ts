import { invoke } from '@tauri-apps/api/core';
import {
	createDefaultMserveForm,
	type AutoBackupMode,
	type MserveJsonFormProps,
	type MserveJsonProps,
	type MserveRepairPayload,
	type Provider,
} from '@/lib/mserve-schema';

export type { AutoBackupMode };

export type ServerSetupFormData = MserveJsonFormProps;

export const createDefaultServerSetupForm = (): ServerSetupFormData => createDefaultMserveForm();

export type SyncedMserveConfig = MserveJsonProps;

/** Payload for the `initialize_server` command (create flow). */
export type InitServerPayload = {
	directory: string;
	create_directory_if_missing: boolean;
	file: string;
	ram: number;
	storage_limit: number;
	auto_restart: boolean;
	auto_backup: string[];
	auto_backup_interval: number;
	auto_agree_eula: boolean;
	java_installation: string;
	custom_flags: string[];
	provider: Provider;
};

/** Result of the `initialize_server` / `import_server` commands. */
export type InitServerResult = {
	ok: boolean;
	message: string;
	id: string;
	file: string;
	directory: string;
};

export type SyncMserveJsonResult = {
	status: 'synced' | 'needs_setup';
	message: string;
	config?: SyncedMserveConfig;
	updated: boolean;
};

export type RepairMserveJsonPayload = MserveRepairPayload;

export type PromptMserveRepairOptions = RepairMserveJsonPayload;

export const syncServerMserveJson = (directory: string) =>
	invoke<SyncMserveJsonResult>('sync_server_mserve_json', { directory });

export const repairServerMserveJson = (payload: RepairMserveJsonPayload) =>
	invoke<SyncMserveJsonResult>('repair_server_mserve_json', { payload });
