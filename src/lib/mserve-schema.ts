export type AutoBackupMode = 'interval' | 'on_close' | 'on_start';

export type ProviderChecks = {
	list_polling: boolean;
	tps_polling: boolean;
	version_polling: boolean;
};

export const createDefaultProviderChecks = (): ProviderChecks => ({
	list_polling: true,
	tps_polling: true,
	version_polling: true,
});

export const normalizeProviderChecks = (checks?: Partial<ProviderChecks> | null): ProviderChecks => ({
	list_polling: checks?.list_polling ?? true,
	tps_polling: checks?.tps_polling ?? true,
	version_polling: checks?.version_polling ?? true,
});

export type MserveJsonProps = {
	id: string;
	file: string;
	ram: number;
	storage_limit: number;
	auto_backup: AutoBackupMode[];
	auto_backup_interval: number;
	auto_restart: boolean;
	custom_flags: string[];
	created_at: string;
	java_installation?: string;
	provider?: string;
	version?: string;
	provider_checks: ProviderChecks;
};

export type MserveStats = {
	players: number;
	capacity: number;
	tps: number;
	uptime: Date | null;
	worlds_size_bytes: number;
	backups_size_bytes: number;
};

export type MserveJsonWithStats = MserveJsonProps & {
	stats: MserveStats;
};

export type MserveJsonFormProps = {
	directory: string;
	create_directory_if_missing: boolean;
	file: string;
	ram: number;
	storage_limit: number;
	auto_restart: boolean;
	auto_backup: AutoBackupMode[];
	auto_backup_interval: number;
	auto_agree_eula: boolean;
	java_installation: string;
	provider: string;
	version: string;
};

export type MserveRepairPayload = Pick<
	MserveJsonFormProps,
	| 'directory'
	| 'file'
	| 'ram'
	| 'storage_limit'
	| 'auto_restart'
	| 'auto_backup'
	| 'auto_backup_interval'
	| 'java_installation'
> & {
	create_directory_if_missing?: boolean;
	auto_agree_eula?: boolean;
	custom_flags: string[];
	provider?: string;
	version?: string;
	provider_checks?: ProviderChecks;
};

export type MserveUpdateSettingsPayload = {
	directory: string;
	ram: number;
	storage_limit: number;
	auto_backup: AutoBackupMode[];
	auto_backup_interval: number;
	auto_restart: boolean;
	custom_flags: string[];
	java_installation?: string;
	provider?: string;
	version?: string;
	provider_checks: ProviderChecks;
	jar_swap_path?: string;
	new_directory?: string;
};

export const createDefaultMserveForm = (): MserveJsonFormProps => ({
	directory: '',
	create_directory_if_missing: true,
	file: '',
	ram: 4,
	storage_limit: 200,
	auto_restart: false,
	auto_backup: [],
	auto_backup_interval: 120,
	auto_agree_eula: true,
	java_installation: '',
	provider: '',
	version: '',
});
