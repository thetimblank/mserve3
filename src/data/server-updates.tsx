import React from 'react';
import { type Server, useServers } from '@/data/servers';
import { useUser } from '@/data/user';
import { checkServerJarUpdate, type ServerUpdateCheck } from '@/lib/server-update-service';

/** Per-server update-check state, keyed by server id. Transient (not persisted):
 *  the check re-runs on every app load by design. */
export type ServerUpdateEntry =
	| { status: 'idle' }
	| { status: 'checking' }
	| { status: 'error'; error: string; checkedAt: number }
	| { status: 'result'; check: ServerUpdateCheck; checkedAt: number };

const IDLE_ENTRY: ServerUpdateEntry = { status: 'idle' };

interface ServerUpdatesContextValue {
	getEntry: (serverId: string) => ServerUpdateEntry;
	checkServer: (server: Server) => Promise<void>;
}

const ServerUpdatesContext = React.createContext<ServerUpdatesContextValue | undefined>(undefined);

export const ServerUpdatesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { servers, isReady: serversReady } = useServers();
	const { user, isReady: userReady } = useUser();
	const [entries, setEntries] = React.useState<Record<string, ServerUpdateEntry>>({});
	const inFlightRef = React.useRef<Set<string>>(new Set());

	const checkServer = React.useCallback(async (server: Server) => {
		if (inFlightRef.current.has(server.id)) return;
		inFlightRef.current.add(server.id);
		setEntries((previous) => ({ ...previous, [server.id]: { status: 'checking' } }));

		try {
			const check = await checkServerJarUpdate(server.provider);
			setEntries((previous) => ({
				...previous,
				[server.id]: { status: 'result', check, checkedAt: Date.now() },
			}));
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to check for updates.';
			setEntries((previous) => ({
				...previous,
				[server.id]: { status: 'error', error: message, checkedAt: Date.now() },
			}));
		} finally {
			inFlightRef.current.delete(server.id);
		}
	}, []);

	// One automatic sweep per app load, gated by the global setting. Failures are
	// swallowed per-server inside checkServer so one bad provider can't abort the rest.
	const didAutoCheckRef = React.useRef(false);
	React.useEffect(() => {
		if (didAutoCheckRef.current) return;
		if (!serversReady || !userReady) return;
		if (!user.auto_check_server_updates) return;

		didAutoCheckRef.current = true;
		for (const server of servers) {
			void checkServer(server);
		}
	}, [serversReady, userReady, user.auto_check_server_updates, servers, checkServer]);

	const getEntry = React.useCallback(
		(serverId: string): ServerUpdateEntry => entries[serverId] ?? IDLE_ENTRY,
		[entries],
	);

	const value = React.useMemo<ServerUpdatesContextValue>(
		() => ({ getEntry, checkServer }),
		[getEntry, checkServer],
	);

	return <ServerUpdatesContext.Provider value={value}>{children}</ServerUpdatesContext.Provider>;
};

export const useServerUpdates = (): ServerUpdatesContextValue => {
	const context = React.useContext(ServerUpdatesContext);
	if (!context) {
		throw new Error('useServerUpdates must be used within a ServerUpdatesProvider');
	}
	return context;
};
