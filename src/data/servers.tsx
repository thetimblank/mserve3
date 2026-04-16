import React from 'react';
import { toast } from 'sonner';
import { repairServerMserveJson, syncServerMserveJson } from '@/lib/mserve-sync';
import { requestMserveRepair } from '@/lib/mserve-repair-controller';

export type AutoBackupMode = 'interval' | 'on_close' | 'on_start';
export type ServerStatus = 'online' | 'offline' | 'starting' | 'closing';

export interface MserveJson {
	file: string;
	provider?: string;
	version?: string;
	ram?: number;
	auto_backup?: AutoBackupMode[];
	auto_backup_interval?: number;
	auto_restart?: boolean;
	explicit_info_names?: boolean;
	custom_flags?: string[];
	createdAt?: Date;
}

export interface Server extends MserveJson {
	id: string;
	name: string;
	directory: string;
	status: ServerStatus;
	storage_limit: number;
	backups: {
		createdAt: Date;
		directory: string;
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
	stats: {
		players: number;
		capacity: number;
		tps: number;
		uptime: Date | null;
	};
}

export interface ServerUpdate {
	id?: string;
	name?: string;
	directory?: string;
	status?: ServerStatus;
	storage_limit?: number;
	backups?: Server['backups'];
	datapacks?: Server['datapacks'];
	worlds?: Server['worlds'];
	plugins?: Server['plugins'];
	stats?: Partial<Server['stats']>;
	file?: string;
	provider?: string;
	version?: string;
	ram?: number;
	auto_backup?: AutoBackupMode[];
	auto_backup_interval?: number;
	auto_restart?: boolean;
	explicit_info_names?: boolean;
	custom_flags?: string[];
	createdAt?: Date;
}

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

const STORAGE_KEY = 'mserve.servers.v3';
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

const toUniqueList = (items?: string[]) =>
	Array.from(new Set((items ?? []).map((item) => item.trim()).filter(Boolean)));

const sameStringList = (left?: string[], right?: string[]) => {
	const a = left ?? [];
	const b = right ?? [];
	if (a.length !== b.length) return false;
	return a.every((value, index) => value === b[index]);
};

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
			createdAt: toDate(item.createdAt),
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
	const now = new Date();
	const stats = server.stats ?? { players: 0, capacity: 20, tps: 0, uptime: now };
	return {
		id: server.id?.trim() || generateServerId(),
		storage_limit: server.storage_limit ?? null,
		name: server.name,
		directory: server.directory,
		status: server.status ?? 'offline',
		backups: toUniqueBackups(server.backups),
		datapacks: toUniqueToggleFileList(server.datapacks),
		worlds: toUniqueToggleFileList(server.worlds),
		plugins: toUniqueToggleFileList(server.plugins),
		stats: {
			players: Math.max(0, stats.players ?? 0),
			capacity: Math.max(1, stats.capacity ?? 20),
			tps: Math.max(0, stats.tps ?? 20),
			uptime: stats.uptime && toDate(stats.uptime),
		},
		file: server.file || 'server.jar',
		provider: server.provider,
		version: server.version,
		ram: Math.max(1, server.ram ?? 3),
		auto_backup: server.auto_backup ? Array.from(new Set(server.auto_backup)) : [],
		auto_backup_interval: Math.max(1, server.auto_backup_interval ?? 120),
		auto_restart: server.auto_restart ?? false,
		explicit_info_names: server.explicit_info_names ?? false,
		custom_flags: toUniqueList(server.custom_flags),
		createdAt: toDate(server.createdAt),
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
			let resolvedStorageLimit = server.storage_limit ?? 200;

			if (synced.status === 'needs_setup') {
				const repairPayload = await requestMserveRepair({
					directory: server.directory,
					file: server.file || synced.config?.file || 'server.jar',
					ram: server.ram ?? synced.config?.ram ?? 3,
					storageLimit: resolvedStorageLimit,
					autoBackup: server.auto_backup ?? synced.config?.auto_backup ?? [],
					autoBackupInterval: server.auto_backup_interval ?? synced.config?.auto_backup_interval ?? 120,
					autoRestart: server.auto_restart ?? synced.config?.auto_restart ?? false,
					createDirectoryIfMissing: true,
					autoAgreeEula: true,
					explicitInfoNames: server.explicit_info_names ?? synced.config?.explicit_info_names ?? false,
					customFlags: server.custom_flags ?? synced.config?.custom_flags ?? [],
				});

				if (!repairPayload) {
					toast.error(`Skipped rebuild for ${server.name} because setup was cancelled.`);
					return;
				}

				resolvedStorageLimit = repairPayload.storageLimit;
				synced = await repairServerMserveJson(repairPayload);
			}

			const config = synced.config;
			if (!config) return;

			if (!active) return;

			const changed =
				server.id !== config.id ||
				server.file !== config.file ||
				(server.ram ?? 3) !== config.ram ||
				(server.auto_backup_interval ?? 120) !== config.auto_backup_interval ||
				(server.auto_restart ?? false) !== config.auto_restart ||
				(server.explicit_info_names ?? false) !== config.explicit_info_names ||
				server.storage_limit !== resolvedStorageLimit ||
				!sameStringList(server.auto_backup, config.auto_backup) ||
				!sameStringList(server.custom_flags, config.custom_flags) ||
				server.provider !== config.provider ||
				server.version !== config.version;

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
						storage_limit: resolvedStorageLimit,
						auto_backup: config.auto_backup,
						auto_backup_interval: config.auto_backup_interval,
						auto_restart: config.auto_restart,
						explicit_info_names: config.explicit_info_names,
						custom_flags: config.custom_flags,
						provider: config.provider,
						version: config.version,
						createdAt: new Date(config.createdAt),
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
		setServers((prev) => updateServerInList(prev, id, (server) => normalizeServer({ ...server, status })));
	}, []);

	const updateServerStats = React.useCallback((id: string, stats: Partial<Server['stats']>) => {
		setServers((prev) =>
			updateServerInList(prev, id, (server) =>
				normalizeServer({
					...server,
					stats: {
						...server.stats,
						...stats,
					},
				}),
			),
		);
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
