import React from 'react';
import { toast } from 'sonner';

import { useUser } from '@/data/user';
import { readStoredJson, writeStoredString } from '@/lib/local-storage';
import { getDefaultServersRootPath } from '@/lib/server-root-path';
import { readNetworksConfig, writeNetworksConfig } from '@/lib/network-config-engine';
import {
	createDefaultNetwork,
	normalizeNetwork,
	normalizeNetworks,
	type ManagedNetwork,
} from '@/lib/network-schema';
import { getErrorMessage } from '@/lib/utils';

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

const loadFromLocalStorage = (): ManagedNetwork[] => {
	const parsed = readStoredJson(STORAGE_KEY);
	return Array.isArray(parsed) ? normalizeNetworks(parsed) : [];
};

const saveToLocalStorage = (networks: ManagedNetwork[]) => {
	writeStoredString(STORAGE_KEY, JSON.stringify(networks));
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

			let loaded: ManagedNetwork[] = [];
			// Where saves go. Left empty when the disk file exists but can't be read
			// or parsed: falling back to the localStorage copy is fine for this
			// session, but writing it back would overwrite the user's file.
			let writableRootPath = rootPath;
			if (rootPath) {
				try {
					const result = await readNetworksConfig(rootPath);
					if (result.content) {
						const parsed = JSON.parse(result.content);
						if (!Array.isArray(parsed)) throw new Error('networks.json is not a list of networks.');
						loaded = normalizeNetworks(parsed);
					} else {
						loaded = loadFromLocalStorage();
					}
				} catch (error) {
					writableRootPath = '';
					loaded = loadFromLocalStorage();
					const message = getErrorMessage(error, String(error));
					toast.error(`Could not read networks.json (${message}). Network changes won't be saved to disk until it's fixed.`);
				}
			} else {
				loaded = loadFromLocalStorage();
			}

			if (!active) return;
			rootPathRef.current = writableRootPath;
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
			const message = getErrorMessage(error, 'Failed to save networks.');
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
