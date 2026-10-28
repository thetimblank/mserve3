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

import { isStoppedStatus, useServers, type Server } from '@/data/servers';
import { useServerJavaResolver } from '@/data/java-download';
import {
	startServer,
	stopServer,
	waitForServerReady,
	waitForServerStopped,
	type ServerControlContext,
} from '@/lib/server-controls';
import type { ManagedNetwork } from '@/lib/network-schema';
import { getErrorMessage } from '@/lib/utils';

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
	// The control helpers toast their own errors and resolve to false, so a
	// failure is turned into a throw here to stop the sequence.
	const startOne = React.useCallback(
		async (server: Server) => {
			const javaExecutable = await resolveServerJava(server);
			if (!javaExecutable) {
				throw new Error(`No Java runtime available for ${server.name}.`);
			}
			if (!(await startServer({ ...context(server), javaExecutable }))) {
				throw new Error(`${server.name} failed to start.`);
			}
		},
		[context, resolveServerJava],
	);

	const awaitReady = React.useCallback(async (server: Server) => {
		if (!(await waitForServerReady(server))) {
			throw new Error(`${server.name} didn't come online within 2 minutes.`);
		}
	}, []);

	// Waits for the process to exit, not just for the stop to be accepted, so a
	// restart's start step doesn't race the old JVM.
	const stopOne = React.useCallback(
		async (server: Server) => {
			if (isStoppedStatus(server.status)) return;
			if (!(await stopServer(context(server)))) {
				throw new Error(`${server.name} failed to stop.`);
			}
			if (!(await waitForServerStopped(server))) {
				throw new Error(`${server.name} didn't stop within 30 seconds.`);
			}
		},
		[context],
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
					await awaitReady(backend);
				}
			} else {
				setProgress({ action, mode, currentServerId: null });
				await Promise.all(backends.map((backend) => startOne(backend)));
				await Promise.all(backends.map((backend) => awaitReady(backend)));
			}

			if (proxy) {
				setProgress({ action, mode, currentServerId: proxy.id });
				await startOne(proxy);
				await awaitReady(proxy);
			}
		},
		[resolveServers, startOne, awaitReady],
	);

	const runStop = React.useCallback(
		async (mode: OrchestrationMode, action: OrchestrationAction) => {
			const { backends, proxy } = resolveServers();

			if (proxy) {
				setProgress({ action, mode, currentServerId: proxy.id });
				await stopOne(proxy);
			}

			if (mode === 'sequential') {
				for (const backend of backends) {
					setProgress({ action, mode, currentServerId: backend.id });
					await stopOne(backend);
				}
			} else {
				setProgress({ action, mode, currentServerId: null });
				await Promise.all(backends.map((backend) => stopOne(backend)));
			}
		},
		[resolveServers, stopOne],
	);

	const withBusy = React.useCallback(
		async (label: string, run: () => Promise<void>) => {
			if (busy) return;
			setBusy(true);
			try {
				await run();
				toast.success(label);
			} catch (err) {
				toast.error(getErrorMessage(err, 'Network operation failed.'));
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
