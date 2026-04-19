import React from 'react';
import { toast } from 'sonner';
import { repairServerMserveJson, syncServerMserveJson } from '@/lib/mserve-sync';
import { requestMserveRepair } from '@/lib/mserve-repair-controller';
import { normalizeProviderChecks, type MserveJsonProps, type MserveStats } from '@/lib/mserve-schema';
import { normalizeServerProvider, type ServerProvider } from '@/lib/server-provider';

export type { AutoBackupMode } from '@/lib/mserve-schema';

export type ServerStatus = 'online' | 'offline' | 'starting' | 'closing';

export interface Server extends MserveJsonProps {
	provider: ServerProvider;
	id: string;
	name: string;
	directory: string;
	status: ServerStatus;
	backups: {
		created_at: Date;
		directory: string;
		size?: number;
	}[];
	datapacks: {
		name?: string;
		file: string;
		activated: boolean;
	}[];
	worlds: {
		name?: string;
		file: string;
		size?: number;
		activated: boolean;
	}[];
	plugins: {
		name?: string;
		file: string;
		url?: string;
		size?: number;
		activated: boolean;
	}[];
	stats: MserveStats;
}

export type ServerUpdate = Partial<Omit<Server, 'stats'>> & { stats?: Partial<Server['stats']> };

interface ServersContextValue {
	servers: Server[];
	isReady: boolean;
	addServer: (server: Server) => string;
	upsertServer: (server: Server) => string;
	resetServers: () => void;
	updateServer: (id: string, update: ServerUpdate) => void;
	removeServer: (id: string) => void;
	setServerStatus: (id: string, status: ServerStatus) => void;
	updateServerStats: (id: string, stats: Partial<Server['stats']>) => void;
	getServerById: (id: string) => Server | undefined;
}

const STORAGE_KEY = 'mserve.servers.v4';
let memoryStore: Server[] | null = null;

const generateServerId = () => {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	return `server-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const toDate = (value?: string | Date): Date => {
	if (value instanceof Date) return value;
	if (!value) return new Date();
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const toIsoDateString = (value?: string | Date): string => toDate(value).toISOString();

const toUniqueList = (items?: string[]) =>
	Array.from(new Set((items ?? []).map((item) => item.trim()).filter(Boolean)));

const sameStringList = (left?: string[], right?: string[]) => {
	const a = left ?? [];
	const b = right ?? [];
	if (a.length !== b.length) return false;
	return a.every((value, index) => value === b[index]);
};

const sameProviderChecks = (
	left?: MserveJsonProps['provider_checks'],
	right?: MserveJsonProps['provider_checks'],
) => {
	const a = normalizeProviderChecks(left);
	const b = normalizeProviderChecks(right);
	return (
		a.list_polling === b.list_polling &&
		a.tps_polling === b.tps_polling &&
		a.version_polling === b.version_polling &&
		a.online_polling === b.online_polling &&
		a.ram_polling === b.ram_polling &&
		a.cpu_polling === b.cpu_polling &&
		a.provider_polling === b.provider_polling
	);
};

const toNullableNumber = (value: unknown): number | null => {
	if (value == null) return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return null;
	return Math.max(0, parsed);
};

const toNullableString = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const normalizeTelemetryHost = (value?: string): string => {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : '127.0.0.1';
};

const normalizeTelemetryPort = (value?: number): number => {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		return 25565;
	}
	return parsed;
};

const sameDateValue = (left: Date | null, right: Date | null): boolean => {
	if (left === right) return true;
	if (!left || !right) return false;
	return left.getTime() === right.getTime();
};

const sameStats = (left: MserveStats, right: MserveStats): boolean =>
	left.online === right.online &&
	left.players_online === right.players_online &&
	left.players_max === right.players_max &&
	left.server_version === right.server_version &&
	left.provider_version === right.provider_version &&
	left.tps === right.tps &&
	left.ram_used === right.ram_used &&
	left.cpu_used === right.cpu_used &&
	sameDateValue(left.uptime, right.uptime) &&
	left.worlds_size_bytes === right.worlds_size_bytes &&
	left.backups_size_bytes === right.backups_size_bytes;

const mergeStatsPatch = (current: MserveStats, patch: Partial<MserveStats>): MserveStats => ({
	online: typeof patch.online === 'boolean' ? patch.online : current.online,
	players_online:
		patch.players_online === undefined ? current.players_online : toNullableNumber(patch.players_online),
	players_max: patch.players_max === undefined ? current.players_max : toNullableNumber(patch.players_max),
	server_version:
		patch.server_version === undefined ? current.server_version : toNullableString(patch.server_version),
	provider_version:
		patch.provider_version === undefined
			? current.provider_version
			: toNullableString(patch.provider_version),
	tps: patch.tps === undefined ? current.tps : toNullableNumber(patch.tps),
	ram_used: patch.ram_used === undefined ? current.ram_used : toNullableNumber(patch.ram_used),
	cpu_used: patch.cpu_used === undefined ? current.cpu_used : toNullableNumber(patch.cpu_used),
	uptime: patch.uptime === undefined ? current.uptime : patch.uptime ? toDate(patch.uptime) : null,
	worlds_size_bytes:
		patch.worlds_size_bytes === undefined
			? current.worlds_size_bytes
			: Math.max(0, Number(patch.worlds_size_bytes) || 0),
	backups_size_bytes:
		patch.backups_size_bytes === undefined
			? current.backups_size_bytes
			: Math.max(0, Number(patch.backups_size_bytes) || 0),
});

const toUniqueToggleFileList = <T extends { name?: string; file: string; activated: boolean }>(
	items?: T[],
) => {
	const seen = new Set<string>();
	const normalized: T[] = [];

	for (const item of items ?? []) {
		const file = item.file?.trim();
		if (!file) continue;
		const key = file.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		normalized.push({
			...item,
			name: item.name?.trim() || undefined,
			file,
			activated: item.activated ?? true,
		});
	}

	return normalized;
};

const toUniqueBackups = (items?: Server['backups']) => {
	const seen = new Set<string>();
	const normalized: Server['backups'] = [];

	for (const item of items ?? []) {
		const directory = item.directory?.trim();
		if (!directory) continue;
		const key = directory.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		normalized.push({
			directory,
			created_at: toDate(item.created_at),
			size: Math.max(0, Number(item.size) || 0),
		});
	}

	return normalized;
};

export const createDefaultServers = (): Server[] => [
	// {
	// 	name: 'SMP',
	// 	status: 'offline',
	// 	stats: {
	// 		players: 0,
	// 		tps: 0,
	// 		capacity: 100,
	// 		uptime: null,
	// 	},
	// 	version: '',
	// 	backups: [],
	// 	datapacks: [],
	// 	worlds: [
	// 		{ file: 'world', activated: true },
	// 		{ file: 'world_nether', activated: true },
	// 		{ file: 'world_the_end', activated: true },
	// 	],
	// 	plugins: [],
	// 	auto_backup: [],
	// 	ram: 5,
	// 	directory: '',
	// 	file: '',
	// 	auto_backup_interval: 120,
	// 	auto_restart: false,
	// },
];

export const normalizeServer = (server: Server): Server => {
	const rawStats = (server.stats ?? {}) as Partial<MserveStats> & {
		players?: number;
		capacity?: number;
	};
	const normalizedProvider = normalizeServerProvider(server.provider);
	const playersOnline = toNullableNumber(rawStats.players_online ?? rawStats.players);
	const playersMax = toNullableNumber(rawStats.players_max ?? rawStats.capacity);
	const tps = toNullableNumber(rawStats.tps);
	const online =
		typeof rawStats.online === 'boolean'
			? rawStats.online
			: server.status === 'online' || server.status === 'starting';
	return {
		id: server.id?.trim() || generateServerId(),
		storage_limit: Math.max(1, Number(server.storage_limit) || 200),
		name: server.name,
		directory: server.directory,
		status: server.status ?? 'offline',
		backups: toUniqueBackups(server.backups),
		datapacks: toUniqueToggleFileList(server.datapacks),
		worlds: toUniqueToggleFileList(server.worlds),
		plugins: toUniqueToggleFileList(server.plugins),
		stats: {
			online,
			players_online: playersOnline,
			players_max: playersMax,
			server_version: toNullableString(rawStats.server_version ?? server.version),
			provider_version:
				toNullableString(rawStats.provider_version) ?? toNullableString(normalizedProvider),
			tps,
			ram_used: toNullableNumber(rawStats.ram_used),
			cpu_used: toNullableNumber(rawStats.cpu_used),
			uptime: rawStats.uptime ? toDate(rawStats.uptime) : null,
			worlds_size_bytes: Math.max(0, Number(rawStats.worlds_size_bytes) || 0),
			backups_size_bytes: Math.max(0, Number(rawStats.backups_size_bytes) || 0),
		},
		file: server.file || 'server.jar',
		provider: normalizedProvider,
		version: server.version,
		provider_checks: normalizeProviderChecks(server.provider_checks),
		telemetry_host: normalizeTelemetryHost(server.telemetry_host),
		telemetry_port: normalizeTelemetryPort(server.telemetry_port),
		ram: Math.max(1, Number(server.ram) || 3),
		auto_backup: Array.from(new Set(server.auto_backup)),
		auto_backup_interval: Math.max(1, Number(server.auto_backup_interval) || 120),
		auto_restart: Boolean(server.auto_restart),
		java_installation: server.java_installation?.trim() || undefined,
		custom_flags: toUniqueList(server.custom_flags),
		created_at: toIsoDateString(server.created_at),
	};
};

export const normalizeServers = (servers: Server[]) => servers.map(normalizeServer);

const hasLocalStorage = () => {
	try {
		return typeof window !== 'undefined' && !!window.localStorage;
	} catch {
		return false;
	}
};

const loadServers = async (): Promise<Server[]> => {
	if (!hasLocalStorage()) {
		if (memoryStore) return memoryStore;
		const defaults = createDefaultServers();
		memoryStore = defaults;
		return defaults;
	}

	const stored = window.localStorage.getItem(STORAGE_KEY);
	if (!stored) {
		const defaults = createDefaultServers();
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
		return defaults;
	}

	try {
		const parsed = JSON.parse(stored) as Server[];
		if (!Array.isArray(parsed)) throw new Error('Invalid servers payload');
		return normalizeServers(parsed);
	} catch {
		const defaults = createDefaultServers();
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
		return defaults;
	}
};

const saveServers = async (servers: Server[]): Promise<void> => {
	if (!hasLocalStorage()) {
		memoryStore = servers;
		return;
	}
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
	} catch {
		// Ignore storage errors
	}
};

const updateServerInList = (servers: Server[], id: string, updater: (server: Server) => Server) =>
	servers.map((server) => (server.id === id ? updater(server) : server));

const ServersContext = React.createContext<ServersContextValue | undefined>(undefined);

export const ServersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [servers, setServers] = React.useState<Server[]>([]);
	const [isReady, setIsReady] = React.useState(false);
	const didInitialDiskSyncRef = React.useRef(false);

	React.useEffect(() => {
		let active = true;
		loadServers().then((loaded) => {
			if (!active) return;
			setServers(loaded);
			setIsReady(true);
		});
		return () => {
			active = false;
		};
	}, []);

	React.useEffect(() => {
		if (!isReady) return;
		saveServers(servers);
	}, [servers, isReady]);

	React.useEffect(() => {
		if (!isReady || didInitialDiskSyncRef.current) return;
		didInitialDiskSyncRef.current = true;

		let active = true;

		const syncServerFromDisk = async (server: Server) => {
			let synced = await syncServerMserveJson(server.directory);

			if (synced.status === 'needs_setup') {
				const config = synced.config;
				if (!config) {
					throw new Error('Could not load fallback mserve configuration for repair.');
				}

				const repairPayload = await requestMserveRepair({
					directory: server.directory,
					file: server.file || config.file,
					ram: server.ram,
					storage_limit: server.storage_limit,
					auto_backup: server.auto_backup,
					auto_backup_interval: server.auto_backup_interval,
					auto_restart: server.auto_restart,
					create_directory_if_missing: true,
					auto_agree_eula: true,
					java_installation: server.java_installation ?? '',
					custom_flags: server.custom_flags,
					provider: server.provider,
					version: server.version ?? config.version,
					provider_checks: normalizeProviderChecks(server.provider_checks ?? config.provider_checks),
					telemetry_host: server.telemetry_host ?? config.telemetry_host,
					telemetry_port: server.telemetry_port ?? config.telemetry_port,
				});

				if (!repairPayload) {
					toast.error(`Skipped rebuild for ${server.name} because setup was cancelled.`);
					return;
				}

				synced = await repairServerMserveJson(repairPayload);
			}

			const config = synced.config;
			if (!config) return;

			if (!active) return;

			const changed =
				server.id !== config.id ||
				server.file !== config.file ||
				server.ram !== config.ram ||
				server.storage_limit !== config.storage_limit ||
				server.auto_backup_interval !== config.auto_backup_interval ||
				server.auto_restart !== config.auto_restart ||
				(server.java_installation ?? '') !== (config.java_installation ?? '') ||
				!sameStringList(server.auto_backup, config.auto_backup) ||
				!sameStringList(server.custom_flags, config.custom_flags) ||
				!sameProviderChecks(server.provider_checks, config.provider_checks) ||
				server.provider !== normalizeServerProvider(config.provider) ||
				server.version !== config.version ||
				normalizeTelemetryHost(server.telemetry_host) !== normalizeTelemetryHost(config.telemetry_host) ||
				normalizeTelemetryPort(server.telemetry_port) !== normalizeTelemetryPort(config.telemetry_port);

			if (!changed) return;

			setServers((prev) =>
				prev.map((candidate) => {
					if (candidate.id !== server.id) {
						return candidate;
					}

					return normalizeServer({
						...candidate,
						id: config.id,
						file: config.file,
						ram: config.ram,
						storage_limit: config.storage_limit,
						auto_backup: config.auto_backup,
						auto_backup_interval: config.auto_backup_interval,
						auto_restart: config.auto_restart,
						java_installation: config.java_installation,
						custom_flags: config.custom_flags,
						provider: normalizeServerProvider(config.provider),
						version: config.version,
						provider_checks: config.provider_checks,
						telemetry_host: config.telemetry_host,
						telemetry_port: config.telemetry_port,
						created_at: config.created_at,
					});
				}),
			);
		};

		void (async () => {
			for (const server of servers) {
				if (!active) return;
				try {
					await syncServerFromDisk(server);
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Failed to sync mserve.json.';
					toast.error(`${server.name}: ${message}`);
				}
			}
		})();

		return () => {
			active = false;
		};
	}, [isReady, servers]);

	const addServer = React.useCallback((server: Server) => {
		const normalized = normalizeServer(server);
		const id = normalized.id;
		setServers((prev) => {
			if (prev.some((item) => item.id === id)) {
				return prev;
			}
			return [...prev, normalized];
		});
		return id;
	}, []);

	const upsertServer = React.useCallback((server: Server) => {
		const normalized = normalizeServer(server);
		const id = normalized.id;
		setServers((prev) => {
			const existing = prev.findIndex((item) => item.id === id);
			if (existing === -1) return [...prev, normalized];
			return prev.map((item, index) => (index === existing ? normalized : item));
		});
		return id;
	}, []);

	const resetServers = React.useCallback(() => {
		setServers(normalizeServers(createDefaultServers()));
	}, []);

	const updateServer = React.useCallback((id: string, update: ServerUpdate) => {
		setServers((prev) =>
			updateServerInList(prev, id, (server) =>
				normalizeServer({
					...server,
					...update,
					stats: {
						...server.stats,
						...update.stats,
					},
				}),
			),
		);
	}, []);

	const removeServer = React.useCallback((id: string) => {
		setServers((prev) => prev.filter((server) => server.id !== id));
	}, []);

	const setServerStatus = React.useCallback((id: string, status: ServerStatus) => {
		setServers((prev) => {
			let changed = false;
			const next = updateServerInList(prev, id, (server) => {
				if (server.status === status) {
					return server;
				}
				changed = true;
				return {
					...server,
					status,
				};
			});

			return changed ? next : prev;
		});
	}, []);

	const updateServerStats = React.useCallback((id: string, stats: Partial<Server['stats']>) => {
		setServers((prev) => {
			let changed = false;
			const next = updateServerInList(prev, id, (server) => {
				const mergedStats = mergeStatsPatch(server.stats, stats);
				if (sameStats(server.stats, mergedStats)) {
					return server;
				}

				changed = true;
				return {
					...server,
					stats: mergedStats,
				};
			});

			return changed ? next : prev;
		});
	}, []);

	const getServerById = React.useCallback(
		(id: string) => servers.find((server) => server.id === id),
		[servers],
	);

	const value: ServersContextValue = {
		servers,
		isReady,
		addServer,
		upsertServer,
		resetServers,
		updateServer,
		removeServer,
		setServerStatus,
		updateServerStats,
		getServerById,
	};

	return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>;
};

export const useServers = () => {
	const context = React.useContext(ServersContext);
	if (!context) {
		throw new Error('useServers must be used within a ServersProvider');
	}
	return context;
};
