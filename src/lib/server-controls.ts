/**
 * Imperative start/stop/restart/force-kill helpers shared by the server card,
 * the dashboard, the network canvas context menu, and network-wide
 * orchestration. Each helper drives an optimistic status, toasts on failure, and
 * resolves to `true` on success (never throws) so callers can sequence them
 * without try/catch. Commands that only *begin* a transition (start, stop,
 * restart, sleep) leave the final status to the authoritative
 * `server-runtime-state` event; use {@link waitForServerReady} /
 * {@link waitForServerStopped} to sequence on the real outcome.
 */
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

import type { Server, ServerStatus } from '@/data/servers';
import { mapRuntimeStateToStatus, offlineServerStats, startingServerStats } from '@/lib/server-telemetry';
import type { ServerRuntimeSnapshot } from '@/pages/server/server-types';

export type ServerControlContext = {
	server: Pick<Server, 'id' | 'directory' | 'provider'>;
	/** The already-resolved java executable path (from useServerJavaResolver). */
	javaExecutable?: string;
	setServerStatus: (id: string, status: ServerStatus) => void;
	updateServerStats: (id: string, stats: Partial<Server['stats']>) => void;
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getRuntimeState = (directory: string) =>
	invoke<ServerRuntimeSnapshot>('get_server_runtime', { directory }).then((runtime) => runtime.state);

/** After a failed command, show whatever the backend says the server is doing. */
const refreshStatus = async ({ server, setServerStatus, updateServerStats }: ServerControlContext) => {
	const state = await getRuntimeState(server.directory).catch(() => 'offline' as const);
	const status = mapRuntimeStateToStatus(state);
	setServerStatus(server.id, status);
	if (status === 'offline' || status === 'crashed') updateServerStats(server.id, offlineServerStats());
};

export const startServer = async ({
	server,
	javaExecutable,
	setServerStatus,
	updateServerStats,
}: ServerControlContext): Promise<boolean> => {
	setServerStatus(server.id, 'starting');
	updateServerStats(server.id, startingServerStats());
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
		updateServerStats(server.id, offlineServerStats());
		toast.error(err instanceof Error ? err.message : 'Failed to start server.');
		return false;
	}
};

/**
 * Requests a graceful stop. The backend only *sends* the stop, so the status
 * stays `closing` until the `offline` event arrives once the process has exited.
 */
export const stopServer = async (context: ServerControlContext): Promise<boolean> => {
	context.setServerStatus(context.server.id, 'closing');
	try {
		await invoke('stop_server', { directory: context.server.directory });
		return true;
	} catch (err) {
		toast.error(err instanceof Error ? err.message : 'Failed to stop server.');
		await refreshStatus(context);
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
		updateServerStats(server.id, offlineServerStats());
		return true;
	} catch (err) {
		setServerStatus(server.id, 'offline');
		updateServerStats(server.id, offlineServerStats());
		toast.error(err instanceof Error ? err.message : 'Failed to force kill server process.');
		return false;
	}
};

/**
 * Manually parks an online, non-proxy server in sleep mode right now, bypassing
 * the per-server auto-sleep toggle (a manual request always wins). Leaves status
 * `closing`; the authoritative `server-runtime-state` event (sleeping, or offline
 * if the server couldn't be spawned into sleep mode) corrects it once the process
 * actually exits.
 */
export const sleepServer = async ({ server, setServerStatus }: ServerControlContext): Promise<boolean> => {
	setServerStatus(server.id, 'closing');
	try {
		await invoke('sleep_server', { directory: server.directory });
		return true;
	} catch (err) {
		setServerStatus(server.id, 'online');
		toast.error(err instanceof Error ? err.message : 'Failed to put server to sleep.');
		return false;
	}
};

export const restartServer = async (context: ServerControlContext): Promise<boolean> => {
	const { server, javaExecutable, setServerStatus } = context;
	setServerStatus(server.id, 'closing');
	try {
		// The backend stops, waits for exit, then starts again; authoritative state
		// transitions arrive via the `server-runtime-state` event.
		await invoke('restart_server', { directory: server.directory, javaExecutable });
		return true;
	} catch (err) {
		toast.error(err instanceof Error ? err.message : 'Failed to restart server.');
		await refreshStatus(context);
		return false;
	}
};

/**
 * Resolve once a server actually reaches the backend `online` (or adopted
 * `running-external`) state, or after `timeoutMs`. This is universal — it works
 * for every provider, including ones that don't answer a status ping, because it
 * relies on the supervisor's authoritative port-based detection.
 */
export const waitForServerReady = async (
	server: Pick<Server, 'directory'>,
	options?: { timeoutMs?: number; pollMs?: number },
): Promise<boolean> => {
	const timeoutMs = options?.timeoutMs ?? 120_000;
	const pollMs = options?.pollMs ?? 1500;
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		try {
			const state = await getRuntimeState(server.directory);
			if (state === 'online' || state === 'running-external') return true;
		} catch {
			// Backend not ready yet; keep polling.
		}
		await delay(pollMs);
	}

	return false;
};

/**
 * Resolve once a server's process is actually gone (`offline` or `crashed`), or
 * `false` after `timeoutMs`. The backend escalates a graceful stop to a kill
 * after ~10s, so the default leaves room for that.
 */
export const waitForServerStopped = async (
	server: Pick<Server, 'directory'>,
	options?: { timeoutMs?: number; pollMs?: number },
): Promise<boolean> => {
	const timeoutMs = options?.timeoutMs ?? 30_000;
	const pollMs = options?.pollMs ?? 500;
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		try {
			const state = await getRuntimeState(server.directory);
			if (state === 'offline' || state === 'crashed') return true;
		} catch {
			// Keep polling.
		}
		await delay(pollMs);
	}

	return false;
};
