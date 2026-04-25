import { TELEMETRY_POLLING } from './mserve-consts';

export type AutoBackupMode = 'interval' | 'on_close' | 'on_start';
export type ProviderName = 'paper' | 'folia' | 'spigot' | 'vanilla' | 'velocity' | 'bungeecord';
export type TelemetryKey = (typeof TELEMETRY_POLLING)[number];
export type TelemetryPolling = TelemetryKey[];
export type ProviderKind = 'plugin' | 'vanilla' | 'proxy' | 'unknown';
export type ProviderTab = 'plugin' | 'vanilla' | 'proxies';

export interface Provider {
	name: ProviderName;
	file: string;
	download_url?: string;
	provider_version: string;
	minecraft_version: string;
	/**
	 * @example 21 = 'JDK v21'
	 */
	jdk_versions: number[];
	supported_telemetry: TelemetryPolling;
	stable: boolean;
	aliases?: string[];
	description?: string;
	kind?: ProviderKind;
	tab?: ProviderTab;
	stable_name?: string;
	unstable_name?: string;
	supports_list_command?: boolean;
	supports_tps_command?: boolean;
	supports_version_command?: boolean;
}

export const createDefaultProviderChecks = (): TelemetryPolling => [...TELEMETRY_POLLING];

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
	java_installation: string | undefined;
	provider: Provider;
	telemetry_host: string;
	telemetry_port: number;
};

export type MserveStats = {
	online: boolean;
	players_online: number | null;
	players_max: number | null;
	server_version: string | null;
	provider_version: string | null;
	tps: number | null;
	ram_used: number | null;
	cpu_used: number | null;
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
	provider: Provider | null;
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
	provider: Provider;
	telemetry_host?: string;
	telemetry_port?: number;
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
	provider: Provider;
	telemetry_host?: string;
	telemetry_port?: number;
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
	auto_backup: ['on_close'],
	auto_backup_interval: 120,
	auto_agree_eula: true,
	java_installation: '',
	provider: null,
});
