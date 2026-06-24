/**
 * App-wide runtime monitor for servers that are *not* currently open on their
 * detail page. Without this, starting a server from the dashboard or network
 * view only flipped its status to "online" optimistically and then nothing ever
 * verified the process actually came up (or later died), so a server could read
 * as online while never really starting.
 *
 * This component mirrors the lifecycle parts of {@link useServerRuntime}:
 *  - readiness: a global `server-output` listener flips `starting -> online`
 *    when a server prints its ready line (the only signal proxies expose);
 *  - readiness/stats: telemetry polling flips `starting -> online` for providers
 *    that answer a status ping and keeps dashboard/network stats fresh;
 *  - liveness: runtime-status polling flips a server `offline` once its process
 *    exits, honoring auto-restart.
 *
 * Servers claimed by an open detail page ({@link isServerRuntimeClaimed}) are
 * skipped here so the two loops never fight over the same server's status.
 */
import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { useServers } from '@/data/servers';
import { useUser } from '@/data/user';
import { isServerRuntimeClaimed } from '@/lib/server-runtime-registry';
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';
import { mapTelemetryToStats, providerSupportsOnlinePing } from '@/lib/server-telemetry';
import { isServerReadyLine, stripAnsi } from '@/lib/utils';
import type {
	RuntimeStatusResult,
	ServerOutputEvent,
	ServerTelemetryResult,
} from '@/pages/server/server-types';

const LIVENESS_POLL_INTERVAL_MS = 2500;
const TELEMETRY_POLL_INTERVAL_MS = 5000;
// Grace period after a server first appears non-offline before its missing
// process is treated as "exited". Covers the brief window between optimistically
// setting `starting` and the backend actually spawning the child.
const STARTUP_GRACE_MS = 15000;
// Minimum gap between auto-restart attempts so a server that crashes on boot
// doesn't spin in a tight restart loop.
const AUTO_RESTART_COOLDOWN_MS = 15000;

type LivenessEntry = {
	nonOfflineSince: number;
	everRunning: boolean;
	lastRestartAt: number;
};

const offlineStats = () => ({
	online: false,
	players_online: null,
	players_max: null,
	server_version: null,
	tps: null,
	ram_used: null,
	cpu_used: null,
	uptime: null,
});

export const ServerRuntimeMonitor: React.FC = () => {
	const { servers, setServerStatus, updateServerStats } = useServers();
	const { user } = useUser();

	// Latest server list / java default kept in refs so the polling effects don't
	// restart (and reset their intervals) on every stats update.
	const serversRef = React.useRef(servers);
	serversRef.current = servers;
	const javaDefaultRef = React.useRef(user.java_installation_default);
	javaDefaultRef.current = user.java_installation_default;

	const livenessRef = React.useRef<Map<string, LivenessEntry>>(new Map());

	// Readiness via server output. The listener is always mounted, so a ready
	// line is caught even when the server was started from another page.
	React.useEffect(() => {
		let active = true;
		let unlisten: UnlistenFn | null = null;

		listen<ServerOutputEvent>('server-output', (event) => {
			if (!active) return;
			if (event.payload.stream !== 'stdout') return;

			const server = serversRef.current.find((item) => item.directory === event.payload.directory);
			if (!server) return;
			if (isServerRuntimeClaimed(server.id)) return;
			if (server.status === 'offline' || server.status === 'closing' || server.status === 'online') return;

			const cleaned = stripAnsi(event.payload.line);
			const kind = getServerProviderCapabilities(server.provider).kind;
			if (isServerReadyLine(cleaned, kind)) {
				setServerStatus(server.id, 'online');
				updateServerStats(server.id, {
					online: true,
					uptime: server.stats.uptime ?? new Date(),
				});
			}
		})
			.then((cleanup) => {
				if (!active) {
					cleanup();
					return;
				}
				unlisten = cleanup;
			})
			.catch(() => {});

		return () => {
			active = false;
			if (unlisten) unlisten();
		};
	}, [setServerStatus, updateServerStats]);

	// Liveness: detect a server's process exiting and flip it offline (or
	// auto-restart it).
	React.useEffect(() => {
		let active = true;
		const inFlight = new Set<string>();

		const poll = async () => {
			const tracked = serversRef.current.filter(
				(server) => server.status !== 'offline' && !isServerRuntimeClaimed(server.id),
			);
			const trackedIds = new Set(tracked.map((server) => server.id));

			// Drop bookkeeping for servers that are no longer being tracked.
			for (const id of livenessRef.current.keys()) {
				if (!trackedIds.has(id)) livenessRef.current.delete(id);
			}

			await Promise.all(
				tracked.map(async (server) => {
					if (inFlight.has(server.id)) return;
					inFlight.add(server.id);

					const now = Date.now();
					let entry = livenessRef.current.get(server.id);
					if (!entry) {
						entry = { nonOfflineSince: now, everRunning: false, lastRestartAt: 0 };
						livenessRef.current.set(server.id, entry);
					}

					try {
						const runtime = await invoke<RuntimeStatusResult>('get_server_runtime_status', {
							directory: server.directory,
						});
						if (!active) return;

						if (runtime.running) {
							entry.everRunning = true;
							return;
						}

						// Process is not running. Give freshly-started servers a grace
						// window before declaring them dead.
						if (!entry.everRunning && now - entry.nonOfflineSince < STARTUP_GRACE_MS) {
							return;
						}

						const stopInProgress = server.status === 'closing';
						const canAutoRestart =
							!stopInProgress &&
							Boolean(server.auto_restart) &&
							now - entry.lastRestartAt > AUTO_RESTART_COOLDOWN_MS;

						if (canAutoRestart) {
							entry.lastRestartAt = now;
							entry.everRunning = false;
							entry.nonOfflineSince = now;
							setServerStatus(server.id, 'starting');
							updateServerStats(server.id, { ...offlineStats(), uptime: new Date() });
							try {
								await invoke('start_server', {
									directory: server.directory,
									globalJavaInstallation: javaDefaultRef.current,
								});
							} catch {
								if (!active) return;
								setServerStatus(server.id, 'offline');
								updateServerStats(server.id, offlineStats());
								livenessRef.current.delete(server.id);
							}
							return;
						}

						setServerStatus(server.id, 'offline');
						updateServerStats(server.id, offlineStats());
						livenessRef.current.delete(server.id);
					} catch {
						// Backend unavailable; try again next tick.
					} finally {
						inFlight.delete(server.id);
					}
				}),
			);
		};

		void poll();
		const interval = window.setInterval(() => void poll(), LIVENESS_POLL_INTERVAL_MS);
		return () => {
			active = false;
			window.clearInterval(interval);
		};
	}, [setServerStatus, updateServerStats]);

	// Telemetry: flip `starting -> online` for pingable providers and keep stats
	// fresh for servers shown on the dashboard / network view.
	React.useEffect(() => {
		let active = true;
		const inFlight = new Set<string>();

		const poll = async () => {
			const tracked = serversRef.current.filter(
				(server) => server.status !== 'offline' && !isServerRuntimeClaimed(server.id),
			);

			await Promise.all(
				tracked.map(async (server) => {
					if (inFlight.has(server.id)) return;
					inFlight.add(server.id);
					try {
						const telemetry = await invoke<ServerTelemetryResult>('get_server_telemetry', {
							directory: server.directory,
						});
						if (!active) return;

						updateServerStats(
							server.id,
							mapTelemetryToStats(server, telemetry, { fallbackUptime: server.stats.uptime }),
						);

						if (providerSupportsOnlinePing(server) && telemetry.online && server.status === 'starting') {
							setServerStatus(server.id, 'online');
						}
					} catch {
						if (!active) return;
						if (providerSupportsOnlinePing(server)) {
							updateServerStats(server.id, {
								online: false,
								players_online: null,
								players_max: null,
								server_version: null,
							});
						}
					} finally {
						inFlight.delete(server.id);
					}
				}),
			);
		};

		void poll();
		const interval = window.setInterval(() => void poll(), TELEMETRY_POLL_INTERVAL_MS);
		return () => {
			active = false;
			window.clearInterval(interval);
		};
	}, [setServerStatus, updateServerStats]);

	return null;
};

export default ServerRuntimeMonitor;
