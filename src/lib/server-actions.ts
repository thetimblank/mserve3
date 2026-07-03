/**
 * Shared start/stop helpers for driving a server from an *unclaimed* context
 * (the dashboard, the network canvas). The app-wide runtime monitor keeps global
 * state in sync from backend events; these helpers only fire the command plus an
 * optimistic status update, mirroring what the monitor itself does. The
 * server-detail page uses its own claimed hook instead.
 */
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

import type { Server, ServerStatus } from '@/data/servers';
import { resolveServerJavaExecutable } from '@/lib/java-resolution';
import type { JavaRuntimeInfo } from '@/lib/java-runtime-service';
import { offlineServerStats, startingServerStats } from '@/lib/server-telemetry';

type StatusSetter = (id: string, status: ServerStatus) => void;
type StatsSetter = (id: string, stats: Partial<Server['stats']>) => void;

export type StartServerContext = {
	runtimes: JavaRuntimeInfo[];
	globalDefault: string;
	setServerStatus: StatusSetter;
	updateServerStats: StatsSetter;
};

/**
 * Resolves a compatible Java runtime and starts (or wakes) the server. Returns
 * true when the start command was dispatched. On a missing runtime it surfaces a
 * toast rather than prompting for a download — the detail page owns that richer
 * flow.
 */
export const resolveAndStartServer = async (
	server: Server,
	{ runtimes, globalDefault, setServerStatus, updateServerStats }: StartServerContext,
): Promise<boolean> => {
	const resolution = resolveServerJavaExecutable({
		provider: server.provider,
		javaInstallation: server.java_installation,
		globalDefault,
		runtimes,
	});

	if (resolution.status !== 'resolved') {
		toast.error(`${server.name}: no compatible Java runtime. Open the server to install one.`);
		return false;
	}

	setServerStatus(server.id, 'starting');
	updateServerStats(server.id, startingServerStats());
	try {
		await invoke('start_server', {
			directory: server.directory,
			javaExecutable: resolution.executablePath,
		});
		return true;
	} catch (err) {
		setServerStatus(server.id, 'offline');
		updateServerStats(server.id, offlineServerStats());
		toast.error(`${server.name}: ${err instanceof Error ? err.message : 'Failed to start.'}`);
		return false;
	}
};

/** Requests a graceful stop, optimistically flipping the card to "closing". */
export const stopServerAction = async (
	server: Server,
	setServerStatus: StatusSetter,
): Promise<void> => {
	setServerStatus(server.id, 'closing');
	try {
		await invoke('stop_server', { directory: server.directory });
	} catch (err) {
		toast.error(`${server.name}: ${err instanceof Error ? err.message : 'Failed to stop.'}`);
	}
};
