import React from 'react';
import { toast } from 'sonner';

import { useUser } from '@/data/user';
import { getDefaultServersRootPath } from '@/lib/server-root-path';
import { readNetworksConfig, writeNetworksConfig } from '@/lib/network-config-engine';
import {
	createDefaultNetwork,
	normalizeNetwork,
	normalizeNetworks,
	type ManagedNetwork,
} from '@/lib/network-schema';

export type NetworkUpdate =
	| Partial<Omit<ManagedNetwork, 'id'>>
	| ((network: ManagedNetwork) => ManagedNetwork);

interface NetworksContextValue {
	networks: ManagedNetwork[];
	isReady: boolean;
	createNetwork: (name: string) => string;
	addNetwork: (network: ManagedNetwork) => string;
	updateNetwork: (id: string, update: NetworkUpdate) => void;
	removeNetwork: (id: string) => void;
	getNetworkById: (id: string) => ManagedNetwork | undefined;
}

const STORAGE_KEY = 'mserve.networks.v1';

const hasLocalStorage = () => {
	try {
		return typeof window !== 'undefined' && !!window.localStorage;
	} catch {
		return false;
	}
};

const loadFromLocalStorage = (): ManagedNetwork[] => {
	if (!hasLocalStorage()) return [];
	const stored = window.localStorage.getItem(STORAGE_KEY);
	if (!stored) return [];
	try {
		const parsed = JSON.parse(stored);
		return Array.isArray(parsed) ? normalizeNetworks(parsed) : [];
	} catch {
		return [];
	}
};

const saveToLocalStorage = (networks: ManagedNetwork[]) => {
	if (!hasLocalStorage()) return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(networks));
	} catch {
		// Ignore storage errors
	}
};

const resolveRootPath = async (configuredPath: string): Promise<string> => {
	const trimmed = configuredPath.trim();
	if (trimmed) return trimmed;
	try {
		return await getDefaultServersRootPath();
	} catch {
		return '';
	}
};

const NetworksContext = React.createContext<NetworksContextValue | undefined>(undefined);

export const NetworksProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { user, isReady: userReady } = useUser();
	const [networks, setNetworks] = React.useState<ManagedNetwork[]>([]);
	const [isReady, setIsReady] = React.useState(false);
	const rootPathRef = React.useRef('');

	// Initial load: disk is the source of truth, localStorage is the fallback.
	React.useEffect(() => {
		if (!userReady) return;
		let active = true;

		void (async () => {
			const rootPath = await resolveRootPath(user.servers_root_path);
			rootPathRef.current = rootPath;

			let loaded: ManagedNetwork[] = [];
			if (rootPath) {
				try {
					const result = await readNetworksConfig(rootPath);
					if (result.content) {
						const parsed = JSON.parse(result.content);
						loaded = Array.isArray(parsed) ? normalizeNetworks(parsed) : [];
					} else {
						loaded = loadFromLocalStorage();
					}
				} catch {
					loaded = loadFromLocalStorage();
				}
			} else {
				loaded = loadFromLocalStorage();
			}

			if (!active) return;
			setNetworks(loaded);
			setIsReady(true);
		})();

		return () => {
			active = false;
		};
		// Re-run only when the configured root path changes.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [userReady, user.servers_root_path]);

	// Persist to disk + localStorage whenever the set changes.
	React.useEffect(() => {
		if (!isReady) return;
		saveToLocalStorage(networks);

		const rootPath = rootPathRef.current;
		if (!rootPath) return;
		void writeNetworksConfig(rootPath, JSON.stringify(networks, null, 2)).catch((error) => {
			const message = error instanceof Error ? error.message : 'Failed to save networks.';
			toast.error(`Could not save networks: ${message}`);
		});
	}, [networks, isReady]);

	const addNetwork = React.useCallback((network: ManagedNetwork) => {
		const normalized = normalizeNetwork(network);
		setNetworks((prev) =>
			prev.some((item) => item.id === normalized.id) ? prev : [...prev, normalized],
		);
		return normalized.id;
	}, []);

	const createNetwork = React.useCallback((name: string) => {
		const normalized = normalizeNetwork(createDefaultNetwork(name));
		setNetworks((prev) => [...prev, normalized]);
		return normalized.id;
	}, []);

	const updateNetwork = React.useCallback((id: string, update: NetworkUpdate) => {
		setNetworks((prev) =>
			prev.map((network) => {
				if (network.id !== id) return network;
				const next =
					typeof update === 'function'
						? update(network)
						: { ...network, ...update, id: network.id };
				return normalizeNetwork({ ...next, updated_at: new Date().toISOString() });
			}),
		);
	}, []);

	const removeNetwork = React.useCallback((id: string) => {
		setNetworks((prev) => prev.filter((network) => network.id !== id));
	}, []);

	const getNetworkById = React.useCallback(
		(id: string) => networks.find((network) => network.id === id),
		[networks],
	);

	const value: NetworksContextValue = {
		networks,
		isReady,
		createNetwork,
		addNetwork,
		updateNetwork,
		removeNetwork,
		getNetworkById,
	};

	return <NetworksContext.Provider value={value}>{children}</NetworksContext.Provider>;
};

export const useNetworks = () => {
	const context = React.useContext(NetworksContext);
	if (!context) {
		throw new Error('useNetworks must be used within a NetworksProvider');
	}
	return context;
};
