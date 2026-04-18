import { invoke } from '@tauri-apps/api/core';
import {
	createDefaultMserveForm,
	type AutoBackupMode,
	type MserveJsonFormProps,
	type MserveJsonProps,
	type MserveRepairPayload,
} from '@/lib/mserve-schema';

export type { AutoBackupMode };

export type ServerSetupFormData = MserveJsonFormProps;

export const createDefaultServerSetupForm = (): ServerSetupFormData => createDefaultMserveForm();

export type SyncedMserveConfig = MserveJsonProps;

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
