import { TELEMETRY_POLLING } from './mserve-consts';

export type AutoBackupMode = 'interval' | 'on_close' | 'on_start';
/**
 * How old backups are cleaned up:
 * - `smart` — keeps everything recent, then thins to one per day, week, month.
 * - `simple` — only the explicit caps (count / age / storage) apply.
 */
export type BackupPolicy = 'smart' | 'simple';
/** What a backup snapshot captures. */
export type BackupScopeItem = 'worlds' | 'plugins' | 'mods' | 'configs';

export const BACKUP_SCOPE_ITEMS: BackupScopeItem[] = ['worlds', 'plugins', 'mods', 'configs'];

export const normalizeBackupPolicy = (raw: unknown): BackupPolicy =>
	raw === 'simple' ? 'simple' : 'smart';

/** Keeps only known scope items (canonical order); empty falls back to worlds. */
export const normalizeBackupScope = (raw: unknown): BackupScopeItem[] => {
	if (!Array.isArray(raw)) return ['worlds'];
	const items = BACKUP_SCOPE_ITEMS.filter((item) => raw.includes(item));
	return items.length > 0 ? items : ['worlds'];
};
export type ProviderName =
	| 'paper'
	| 'folia'
	| 'purpur'
	| 'spigot'
	| 'vanilla'
	| 'velocity'
	| 'bungeecord'
	| 'fabric'
	| 'forge'
	| 'neoforge';
export type TelemetryKey = (typeof TELEMETRY_POLLING)[number];
export type TelemetryPolling = TelemetryKey[];
export type ProviderKind = 'plugin' | 'vanilla' | 'proxy' | 'modded' | 'unknown';
export type ProviderTab = 'plugin' | 'vanilla' | 'proxies' | 'modded';

/**
 * The provider data that lives in `mserve.json` — version-specific, per-server
 * state. Descriptive, version-independent metadata (kind, tab, command support,
 * channel labels) is NOT stored here; look it up from the catalog via
 * {@link file://./server-provider.ts}'s `getProviderDescriptor(name)`.
 */
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
}

export const createDefaultProviderChecks = (): TelemetryPolling => [...TELEMETRY_POLLING];

export type MserveJsonProps = {
	id: string;
	file: string;
	ram: number;
	storage_limit: number;
	auto_backup: AutoBackupMode[];
	auto_backup_interval: number;
	backup_policy: BackupPolicy;
	/** Maximum number of backups to keep. 0 = no count cap. */
	backup_max_count: number;
	/** Delete backups older than this many days. 0 = no age cap. */
	backup_max_age_days: number;
	backup_scope: BackupScopeItem[];
	auto_restart: boolean;
	/** Sleep mode: stop + hold the port after `sleep_idle_minutes` of no players. */
	sleep_enabled: boolean;
	sleep_idle_minutes: number;
	/** MOTD shown in the server list while sleeping (legacy-§ color codes). */
	sleep_motd: string;
	custom_flags: string[];
	created_at: string;
	java_installation: string | undefined;
	provider: Provider;
	telemetry_host: string;
	telemetry_port: number;
	/** Whether public tunneling (playit.gg) is enabled for this server. */
	tunnel_enabled?: boolean;
	/** Last-known public tunnel address (surfaced even while offline). */
	tunnel_address?: string;
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
	sleep_enabled: boolean;
	sleep_idle_minutes: number;
	sleep_motd: string;
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
	// Sleep-mode fields are optional here; the backend fills defaults when omitted.
	sleep_enabled?: boolean;
	sleep_idle_minutes?: number;
	sleep_motd?: string;
	custom_flags: string[];
	provider: Provider;
	telemetry_host?: string;
	telemetry_port?: number;
};

export const createDefaultMserveForm = (): MserveJsonFormProps => ({
	directory: '',
	create_directory_if_missing: true,
	file: '',
	ram: 4,
	storage_limit: 200,
	auto_restart: false,
	sleep_enabled: false,
	sleep_idle_minutes: 15,
	sleep_motd: '§eSleeping §7— join to wake this server',
	auto_backup: ['on_close'],
	auto_backup_interval: 120,
	auto_agree_eula: true,
	java_installation: '',
	provider: null,
});
