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

/** Backend lifecycle states (mirrors the Rust `LifecycleState`, kebab-case). */
export type ServerRuntimeState =
	| 'offline'
	| 'starting'
	| 'online'
	| 'stopping'
	| 'crashed'
	| 'running-external';

/** A single live telemetry reading from the backend supervisor. */
export type TelemetrySample = {
	timestamp: number;
	online: boolean;
	playersOnline: number | null;
	playersMax: number | null;
	serverVersion: string | null;
	providerVersion: string | null;
	tps: number | null;
	ramUsed: number | null;
	ramBytes: number | null;
	cpuUsed: number | null;
	uptime: string | null;
};

/** Payload of the `server-runtime-state` event. */
export type ServerRuntimeStateEvent = {
	directory: string;
	state: ServerRuntimeState;
	pid: number | null;
	startedAt: string | null;
	exitCode: number | null;
	stderrTail: string[];
};

/** Payload of the `server-telemetry` event. */
export type ServerTelemetryEvent = {
	directory: string;
	sample: TelemetrySample;
};

/** One-shot snapshot returned by the `get_server_runtime` command. */
export type ServerRuntimeSnapshot = {
	state: ServerRuntimeState;
	pid: number | null;
	startedAt: string | null;
	exitCode: number | null;
	stderrTail: string[];
	sample: TelemetrySample | null;
};

/** A bucket-averaged history point for the (future) telemetry timeline graph. */
export type TelemetryHistoryPoint = {
	timestamp: number;
	online: boolean;
	playersOnline: number | null;
	tps: number | null;
	ramBytes: number | null;
	ramUsed: number | null;
	cpuUsed: number | null;
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

/** Per-server tunnel status (mirrors the Rust `ServerTunnelInfo.status` strings,
 * plus the transient `starting`/`error` states pushed via `playit-tunnel-state`). */
export type TunnelStatus = 'online' | 'offline' | 'starting' | 'error' | 'disabled';

/** One-shot snapshot returned by the `get_server_tunnel` command. */
export type ServerTunnelInfo = {
	enabled: boolean;
	address: string | null;
	status: TunnelStatus;
};

/** Payload of the `playit-tunnel-state` event. */
export type PlayitTunnelStateEvent = {
	directory: string;
	status: TunnelStatus;
	address: string | null;
	error: string | null;
};

/** Payload of the `playit-claim-state` event. */
export type PlayitClaimStateEvent = {
	status: 'pending' | 'claimed' | 'error';
	claimUrl: string | null;
	error: string | null;
};

export type ServerContentTab =
	| 'overview'
	| 'statistics'
	| 'plugins'
	| 'worlds'
	| 'datapacks'
	| 'backups'
	| 'settings';

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
