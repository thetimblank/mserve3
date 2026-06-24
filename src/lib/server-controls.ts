/**
 * Imperative start/stop/restart/force-kill helpers shared by the server card,
 * the network canvas context menu, and network-wide orchestration. Each helper
 * drives the same optimistic status/stats transitions the server card has always
 * used, toasts on failure, and resolves to `true` on success (never throws) so
 * callers can sequence them without try/catch.
 */
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

import type { Server, ServerStatus } from '@/data/servers';
import type { ServerTelemetryResult } from '@/pages/server/server-types';
import { providerSupportsOnlinePing } from '@/lib/server-telemetry';

export type ServerControlContext = {
	server: Pick<Server, 'id' | 'directory' | 'provider'>;
	/** The already-resolved java executable path (from useServerJavaResolver). */
	javaExecutable?: string;
	setServerStatus: (id: string, status: ServerStatus) => void;
	updateServerStats: (id: string, stats: Partial<Server['stats']>) => void;
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const offlineStats = (): Partial<Server['stats']> => ({
	online: false,
	players_online: null,
	players_max: null,
	tps: null,
	ram_used: null,
	cpu_used: null,
	uptime: null,
});

const startingStats = (): Partial<Server['stats']> => ({
	online: false,
	players_online: null,
	players_max: null,
	tps: null,
	ram_used: null,
	cpu_used: null,
	uptime: new Date(),
});

export const startServer = async ({
	server,
	javaExecutable,
	setServerStatus,
	updateServerStats,
}: ServerControlContext): Promise<boolean> => {
	setServerStatus(server.id, 'starting');
	updateServerStats(server.id, startingStats());
	try {
		await invoke('start_server', {
			directory: server.directory,
			javaExecutable,
		});
		// Leave the server in `starting`; the app-wide ServerRuntimeMonitor (or the
		// open server detail page) flips it to `online` once the process actually
		// reports ready, and back to `offline` if it never comes up.
		return true;
	} catch (err) {
		setServerStatus(server.id, 'offline');
		updateServerStats(server.id, offlineStats());
		toast.error(err instanceof Error ? err.message : 'Failed to start server.');
		return false;
	}
};

export const stopServer = async ({
	server,
	setServerStatus,
	updateServerStats,
}: ServerControlContext): Promise<boolean> => {
	setServerStatus(server.id, 'closing');
	try {
		await invoke('stop_server', { directory: server.directory });
		setServerStatus(server.id, 'offline');
		updateServerStats(server.id, offlineStats());
		return true;
	} catch (err) {
		setServerStatus(server.id, 'offline');
		updateServerStats(server.id, offlineStats());
		toast.error(err instanceof Error ? err.message : 'Failed to stop server.');
		return false;
	}
};

export const forceKillServer = async ({
	server,
	setServerStatus,
	updateServerStats,
}: ServerControlContext): Promise<boolean> => {
	setServerStatus(server.id, 'closing');
	try {
		await invoke('force_kill_server', { directory: server.directory });
		setServerStatus(server.id, 'offline');
		updateServerStats(server.id, offlineStats());
		return true;
	} catch (err) {
		setServerStatus(server.id, 'offline');
		updateServerStats(server.id, offlineStats());
		toast.error(err instanceof Error ? err.message : 'Failed to force kill server process.');
		return false;
	}
};

export const restartServer = async (context: ServerControlContext): Promise<boolean> => {
	context.setServerStatus(context.server.id, 'closing');
	try {
		await invoke('stop_server', { directory: context.server.directory });
	} catch {
		// Ignore stop failures on restart; proceed to start.
	}
	return startServer(context);
};

/**
 * Resolve once a server is actually reachable (telemetry ping reports online),
 * or after `timeoutMs`. Providers without online-ping support can't be probed,
 * so we just wait a short fixed delay instead.
 */
export const waitForServerReady = async (
	server: Pick<Server, 'directory' | 'provider'>,
	options?: { timeoutMs?: number; pollMs?: number; fixedDelayMs?: number },
): Promise<boolean> => {
	if (!providerSupportsOnlinePing(server)) {
		await delay(options?.fixedDelayMs ?? 4000);
		return true;
	}

	const timeoutMs = options?.timeoutMs ?? 120_000;
	const pollMs = options?.pollMs ?? 3000;
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		try {
			const telemetry = await invoke<ServerTelemetryResult>('get_server_telemetry', {
				directory: server.directory,
			});
			if (telemetry.online) return true;
		} catch {
			// Server not up yet; keep polling.
		}
		await delay(pollMs);
	}

	return false;
};
