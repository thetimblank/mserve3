import React from 'react';

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
	name: string;
	directory: string;
	status: ServerStatus;
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
	name?: string;
	directory?: string;
	status?: ServerStatus;
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
	incrementPlayers: (id: string, delta: number) => void;
	toggleAutoRestart: (id: string) => void;
	setBackupMode: (id: string, mode: AutoBackupMode, enabled: boolean) => void;
	getServerById: (id: string) => Server | undefined;
	getOnlineServers: () => Server[];
	isServerOnline: (id: string) => boolean;
}

const STORAGE_KEY = 'mserve.servers.v1';
let memoryStore: Server[] | null = null;

const toDate = (value?: string | Date): Date => {
	if (value instanceof Date) return value;
	if (!value) return new Date();
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const toUniqueList = (items?: string[]) =>
	Array.from(new Set((items ?? []).map((item) => item.trim()).filter(Boolean)));

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

export const createServerId = (name: string, directory: string) => `${directory}::${name}`;

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
			tps: Math.max(0, stats.tps ?? 0),
			uptime: stats.uptime && toDate(stats.uptime),
		},
		file: server.file || 'server.jar',
		provider: server.provider,
		version: server.version,
		ram: Math.max(1, server.ram ?? 3),
		auto_backup: server.auto_backup?.length
			? Array.from(new Set(server.auto_backup))
			: ['interval', 'on_close'],
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
	servers.map((server) => (createServerId(server.name, server.directory) === id ? updater(server) : server));

const ServersContext = React.createContext<ServersContextValue | undefined>(undefined);

export const ServersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [servers, setServers] = React.useState<Server[]>([]);
	const [isReady, setIsReady] = React.useState(false);

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

	const addServer = React.useCallback((server: Server) => {
		const normalized = normalizeServer(server);
		const id = createServerId(normalized.name, normalized.directory);
		setServers((prev) => {
			if (prev.some((item) => createServerId(item.name, item.directory) === id)) {
				return prev;
			}
			return [...prev, normalized];
		});
		return id;
	}, []);

	const upsertServer = React.useCallback((server: Server) => {
		const normalized = normalizeServer(server);
		const id = createServerId(normalized.name, normalized.directory);
		setServers((prev) => {
			const existing = prev.findIndex((item) => createServerId(item.name, item.directory) === id);
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
		setServers((prev) => prev.filter((server) => createServerId(server.name, server.directory) !== id));
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

	const incrementPlayers = React.useCallback((id: string, delta: number) => {
		setServers((prev) =>
			updateServerInList(prev, id, (server) =>
				normalizeServer({
					...server,
					stats: {
						...server.stats,
						players: Math.max(0, server.stats.players + delta),
					},
				}),
			),
		);
	}, []);

	const toggleAutoRestart = React.useCallback((id: string) => {
		setServers((prev) =>
			updateServerInList(prev, id, (server) =>
				normalizeServer({ ...server, auto_restart: !server.auto_restart }),
			),
		);
	}, []);

	const setBackupMode = React.useCallback((id: string, mode: AutoBackupMode, enabled: boolean) => {
		setServers((prev) =>
			updateServerInList(prev, id, (server) => {
				const current = new Set(server.auto_backup ?? []);
				if (enabled) current.add(mode);
				else current.delete(mode);
				return normalizeServer({ ...server, auto_backup: Array.from(current) });
			}),
		);
	}, []);

	const getServerById = React.useCallback(
		(id: string) => servers.find((server) => createServerId(server.name, server.directory) === id),
		[servers],
	);

	const getOnlineServers = React.useCallback(
		() => servers.filter((server) => server.status === 'online'),
		[servers],
	);

	const isServerOnline = React.useCallback(
		(id: string) =>
			servers.some(
				(server) => createServerId(server.name, server.directory) === id && server.status === 'online',
			),
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
		incrementPlayers,
		toggleAutoRestart,
		setBackupMode,
		getServerById,
		getOnlineServers,
		isServerOnline,
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
