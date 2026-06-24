/**
 * Network-wide start/stop/restart with readiness-aware, role-ordered sequencing.
 *
 * - Start: backends (in `try` order) come up before the proxy. `sequential`
 *   waits for each backend to actually report ready (telemetry ping) before the
 *   next; `staged` starts all backends together, waits for all, then the proxy.
 * - Stop: proxy first (so players disconnect cleanly), then backends.
 * - Restart: stop then start, same mode.
 */
import React from 'react';
import { toast } from 'sonner';

import type { Server } from '@/data/servers';
import { useServers } from '@/data/servers';
import { useServerJavaResolver } from '@/data/java-download';
import { startServer, stopServer, waitForServerReady, type ServerControlContext } from '@/lib/server-controls';
import type { ManagedNetwork } from '@/lib/network-schema';

export type OrchestrationMode = 'sequential' | 'staged';
export type OrchestrationAction = 'start' | 'stop' | 'restart';

export type OrchestrationProgress = {
	action: OrchestrationAction;
	mode: OrchestrationMode;
	currentServerId: string | null;
} | null;

export const useNetworkOrchestration = (network: ManagedNetwork | null, servers: Server[]) => {
	const { setServerStatus, updateServerStats } = useServers();
	const resolveServerJava = useServerJavaResolver();
	const [busy, setBusy] = React.useState(false);
	const [progress, setProgress] = React.useState<OrchestrationProgress>(null);

	const context = React.useCallback(
		(server: Server): ServerControlContext => ({
			server,
			setServerStatus,
			updateServerStats,
		}),
		[setServerStatus, updateServerStats],
	);

	// Resolve the server's Java (prompting to download if missing) before start.
	const startOne = React.useCallback(
		async (server: Server) => {
			const javaExecutable = await resolveServerJava(server);
			if (!javaExecutable) {
				throw new Error(`No Java runtime available for ${server.name}.`);
			}
			await startServer({ ...context(server), javaExecutable });
		},
		[context, resolveServerJava],
	);

	const resolveServers = React.useCallback(() => {
		const byId = new Map(servers.map((server) => [server.id, server]));
		const backends = (network?.members ?? [])
			.slice()
			.sort((left, right) => left.tryIndex - right.tryIndex)
			.map((member) => byId.get(member.serverId))
			.filter((server): server is Server => Boolean(server));
		const proxy = network?.proxyServerId ? byId.get(network.proxyServerId) : undefined;
		return { backends, proxy };
	}, [network, servers]);

	const runStart = React.useCallback(
		async (mode: OrchestrationMode, action: OrchestrationAction) => {
			const { backends, proxy } = resolveServers();

			if (mode === 'sequential') {
				for (const backend of backends) {
					setProgress({ action, mode, currentServerId: backend.id });
					await startOne(backend);
					await waitForServerReady(backend);
				}
			} else {
				setProgress({ action, mode, currentServerId: null });
				await Promise.all(backends.map((backend) => startOne(backend)));
				await Promise.all(backends.map((backend) => waitForServerReady(backend)));
			}

			if (proxy) {
				setProgress({ action, mode, currentServerId: proxy.id });
				await startOne(proxy);
				await waitForServerReady(proxy);
			}
		},
		[resolveServers, startOne],
	);

	const runStop = React.useCallback(
		async (mode: OrchestrationMode, action: OrchestrationAction) => {
			const { backends, proxy } = resolveServers();

			if (proxy) {
				setProgress({ action, mode, currentServerId: proxy.id });
				await stopServer(context(proxy));
			}

			if (mode === 'sequential') {
				for (const backend of backends) {
					setProgress({ action, mode, currentServerId: backend.id });
					await stopServer(context(backend));
				}
			} else {
				setProgress({ action, mode, currentServerId: null });
				await Promise.all(backends.map((backend) => stopServer(context(backend))));
			}
		},
		[resolveServers, context],
	);

	const withBusy = React.useCallback(
		async (label: string, run: () => Promise<void>) => {
			if (busy) return;
			setBusy(true);
			try {
				await run();
				toast.success(label);
			} catch (err) {
				toast.error(err instanceof Error ? err.message : 'Network operation failed.');
			} finally {
				setBusy(false);
				setProgress(null);
			}
		},
		[busy],
	);

	const startNetwork = React.useCallback(
		(mode: OrchestrationMode) => withBusy('Network started.', () => runStart(mode, 'start')),
		[withBusy, runStart],
	);

	const stopNetwork = React.useCallback(
		(mode: OrchestrationMode) => withBusy('Network stopped.', () => runStop(mode, 'stop')),
		[withBusy, runStop],
	);

	const restartNetwork = React.useCallback(
		(mode: OrchestrationMode) =>
			withBusy('Network restarted.', async () => {
				await runStop(mode, 'restart');
				await runStart(mode, 'restart');
			}),
		[withBusy, runStop, runStart],
	);

	return { busy, progress, startNetwork, stopNetwork, restartNetwork };
};
