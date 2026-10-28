import { invoke } from '@tauri-apps/api/core';
import { requestMserveRepair } from '@/lib/mserve-repair-controller';
import {
	createDefaultMserveForm,
	type MserveJsonFormProps,
	type MserveJsonProps,
	type MserveRepairPayload,
	type Provider,
} from '@/lib/mserve-schema';

export type ServerSetupFormData = MserveJsonFormProps;

export const createDefaultServerSetupForm = (): ServerSetupFormData => createDefaultMserveForm();

/** The Rust `SyncedMserveConfig` as it arrives over IPC (`Option` → `null`). */
export type SyncedMserveConfig = Omit<MserveJsonProps, 'java_installation'> & {
	java_installation: string | null;
	tunnel_enabled: boolean;
	tunnel_id: string | null;
	tunnel_address: string | null;
};

/** Payload for the `initialize_server` command (create flow). */
export type InitServerPayload = {
	directory: string;
	create_directory_if_missing: boolean;
	/** True when the directory was pre-populated (e.g. by a modpack install). */
	adopt_existing_directory?: boolean;
	file: string;
	ram: number;
	storage_limit: number;
	auto_restart: boolean;
	sleep_enabled?: boolean;
	sleep_idle_minutes?: number;
	sleep_motd?: string;
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

type SyncMserveJsonResult = {
	status: 'synced' | 'needs_setup';
	message: string;
	config?: SyncedMserveConfig;
	updated: boolean;
};

export type RepairMserveJsonPayload = MserveRepairPayload;

export type PromptMserveRepairOptions = RepairMserveJsonPayload;

const syncServerMserveJson = (directory: string) =>
	invoke<SyncMserveJsonResult>('sync_server_mserve_json', { directory });

const repairServerMserveJson = (payload: RepairMserveJsonPayload) =>
	invoke<SyncMserveJsonResult>('repair_server_mserve_json', { payload });

/** The settings a repair form is prefilled with: a known server's, or the backend's fallback. */
export type MserveRepairPrefill = Pick<
	RepairMserveJsonPayload,
	| 'file'
	| 'ram'
	| 'storage_limit'
	| 'auto_backup'
	| 'auto_backup_interval'
	| 'auto_restart'
	| 'sleep_enabled'
	| 'sleep_idle_minutes'
	| 'sleep_motd'
	| 'custom_flags'
	| 'provider'
	| 'telemetry_host'
	| 'telemetry_port'
> & { java_installation?: string | null };

export type SyncedMserveJson = {
	config: SyncedMserveConfig;
	message: string;
	/** The backend rewrote mserve.json on its own (e.g. filled missing fields). */
	updated: boolean;
	/** The user rebuilt mserve.json through the repair dialog. */
	repaired: boolean;
};

/**
 * Syncs a server's mserve.json and, when it needs setup, asks the user to
 * rebuild it through the repair dialog, prefilled by `prefill` (given the
 * backend's fallback config). Resolves `null` when the user cancels the repair.
 */
export const syncMserveJsonWithRepair = async (
	directory: string,
	prefill: (fallback: SyncedMserveConfig) => MserveRepairPrefill,
): Promise<SyncedMserveJson | null> => {
	let synced = await syncServerMserveJson(directory);
	let repaired = false;

	if (synced.status === 'needs_setup') {
		if (!synced.config) {
			throw new Error('Could not load fallback mserve.json data for repair.');
		}
		const source = prefill(synced.config);
		// Field by field: a prefill can be a whole Server, and the repair payload
		// must only carry mserve.json fields.
		const payload = await requestMserveRepair({
			directory,
			file: source.file,
			ram: source.ram,
			storage_limit: source.storage_limit,
			auto_backup: source.auto_backup,
			auto_backup_interval: source.auto_backup_interval,
			auto_restart: source.auto_restart,
			sleep_enabled: source.sleep_enabled,
			sleep_idle_minutes: source.sleep_idle_minutes,
			sleep_motd: source.sleep_motd,
			create_directory_if_missing: true,
			auto_agree_eula: true,
			java_installation: source.java_installation ?? '',
			custom_flags: source.custom_flags,
			provider: source.provider,
			telemetry_host: source.telemetry_host,
			telemetry_port: source.telemetry_port,
		});
		if (!payload) return null;
		synced = await repairServerMserveJson(payload);
		repaired = true;
	}

	if (!synced.config) {
		throw new Error('Could not resolve valid mserve.json data for this server.');
	}
	return { config: synced.config, message: synced.message, updated: synced.updated, repaired };
};
