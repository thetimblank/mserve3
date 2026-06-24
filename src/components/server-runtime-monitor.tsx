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
import { useJavaRuntimes } from '@/data/java-runtimes';
import { isServerRuntimeClaimed } from '@/lib/server-runtime-registry';
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';
import { mapTelemetryToStats, providerSupportsOnlinePing } from '@/lib/server-telemetry';
import { isJavaVersionError, isServerReadyLine, stripAnsi } from '@/lib/utils';
import { planJavaFallback, resolveServerJavaExecutable } from '@/lib/java-resolution';
import { setServerJavaInstallation, type JavaRuntimeInfo } from '@/lib/java-runtime-service';
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

// Per-server start-failure (wrong Java) bookkeeping for background servers.
type JavaFallbackEntry = {
	flagged: boolean;
	attemptedMajors: number[];
	didFallback: boolean;
	lastExecutable: string | null;
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
	const { servers, setServerStatus, updateServer, updateServerStats } = useServers();
	const { user } = useUser();
	const { runtimes } = useJavaRuntimes();

	// Latest server list / java default / runtimes kept in refs so the polling
	// effects don't restart (and reset their intervals) on every stats update.
	const serversRef = React.useRef(servers);
	serversRef.current = servers;
	const javaDefaultRef = React.useRef(user.java_installation_default);
	javaDefaultRef.current = user.java_installation_default;
	const runtimesRef = React.useRef<JavaRuntimeInfo[]>(runtimes);
	runtimesRef.current = runtimes;

	const livenessRef = React.useRef<Map<string, LivenessEntry>>(new Map());
	const javaFallbackRef = React.useRef<Map<string, JavaFallbackEntry>>(new Map());

	// Readiness via server output. The listener is always mounted, so a ready
	// line is caught even when the server was started from another page.
	React.useEffect(() => {
		let active = true;
		let unlisten: UnlistenFn | null = null;

		listen<ServerOutputEvent>('server-output', (event) => {
			if (!active) return;
			if (event.payload.stream !== 'stdout' && event.payload.stream !== 'stderr') return;

			const server = serversRef.current.find((item) => item.directory === event.payload.directory);
			if (!server) return;
			if (isServerRuntimeClaimed(server.id)) return;
			if (server.status === 'offline' || server.status === 'closing') return;

			const cleaned = stripAnsi(event.payload.line);

			// Wrong-Java detection (often on stderr): flag for the liveness loop to
			// step down. Record the currently-resolved (failing) major so the next
			// plan excludes it. Only the first error per cycle records/flags.
			if (isJavaVersionError(cleaned) && (server.java_installation ?? '').trim() === '') {
				let entry = javaFallbackRef.current.get(server.id);
				if (!entry) {
					entry = { flagged: false, attemptedMajors: [], didFallback: false, lastExecutable: null };
					javaFallbackRef.current.set(server.id, entry);
				}
				if (!entry.flagged) {
					const res = resolveServerJavaExecutable({
						provider: server.provider,
						javaInstallation: server.java_installation,
						globalDefault: javaDefaultRef.current,
						runtimes: runtimesRef.current,
						excludeMajors: entry.attemptedMajors,
					});
					if (
						res.status === 'resolved' &&
						res.majorVersion != null &&
						!entry.attemptedMajors.includes(res.majorVersion)
					) {
						entry.attemptedMajors.push(res.majorVersion);
					}
					entry.flagged = true;
				}
				return;
			}

			if (event.payload.stream !== 'stdout') return;

			const kind = getServerProviderCapabilities(server.provider).kind;
			// Process the ready line even if telemetry already flipped the server
			// online, so a stepped-down Java still gets pinned for next time.
			if (isServerReadyLine(cleaned, kind)) {
				if (server.status !== 'online') {
					setServerStatus(server.id, 'online');
					updateServerStats(server.id, {
						online: true,
						uptime: server.stats.uptime ?? new Date(),
					});
				}

				// If we stepped down to a working Java, pin it for next time.
				const fb = javaFallbackRef.current.get(server.id);
				if (fb?.didFallback && fb.lastExecutable && (server.java_installation ?? '').trim() === '') {
					const pinned = fb.lastExecutable;
					void setServerJavaInstallation(server.directory, pinned)
						.then(() => updateServer(server.id, { java_installation: pinned }))
						.catch(() => {});
				}
				javaFallbackRef.current.delete(server.id);
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
	}, [setServerStatus, updateServer, updateServerStats]);

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
			for (const id of javaFallbackRef.current.keys()) {
				if (!trackedIds.has(id)) javaFallbackRef.current.delete(id);
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

						const fallback = javaFallbackRef.current.get(server.id);
						// Only a wrong-Java error *before the server ever ran* is a real
						// version mismatch; a matching string after it was up is a false
						// positive from logs.
						const hadVersionError = (fallback?.flagged ?? false) && !entry.everRunning;

						// Process is not running. Give freshly-started servers a grace
						// window before declaring them dead — unless a wrong-Java error
						// already told us exactly why it died.
						if (!hadVersionError && !entry.everRunning && now - entry.nonOfflineSince < STARTUP_GRACE_MS) {
							return;
						}

						// Wrong-Java step-down for automatic servers, independent of the
						// auto-restart setting (we're finding the right Java, not looping).
						if (hadVersionError && fallback && (server.java_installation ?? '').trim() === '') {
							fallback.flagged = false;
							const plan = planJavaFallback({
								provider: server.provider,
								globalDefault: javaDefaultRef.current,
								runtimes: runtimesRef.current,
								attemptedMajors: fallback.attemptedMajors,
							});

							if (plan.kind === 'retry') {
								fallback.attemptedMajors.push(plan.majorVersion);
								fallback.didFallback = true;
								fallback.lastExecutable = plan.executablePath;
								entry.everRunning = false;
								entry.nonOfflineSince = now;
								entry.lastRestartAt = now;
								setServerStatus(server.id, 'starting');
								updateServerStats(server.id, { ...offlineStats(), uptime: new Date() });
								try {
									await invoke('start_server', {
										directory: server.directory,
										javaExecutable: plan.executablePath,
									});
								} catch {
									if (!active) return;
									setServerStatus(server.id, 'offline');
									updateServerStats(server.id, offlineStats());
									livenessRef.current.delete(server.id);
									javaFallbackRef.current.delete(server.id);
								}
								return;
							}

							// No installed Java worked — the background monitor can't prompt a
							// download, so go offline (the detail page offers the download).
							setServerStatus(server.id, 'offline');
							updateServerStats(server.id, offlineStats());
							livenessRef.current.delete(server.id);
							javaFallbackRef.current.delete(server.id);
							return;
						}

						const stopInProgress = server.status === 'closing';
						const canAutoRestart =
							!stopInProgress &&
							Boolean(server.auto_restart) &&
							now - entry.lastRestartAt > AUTO_RESTART_COOLDOWN_MS;

						if (canAutoRestart) {
							const resolution = resolveServerJavaExecutable({
								provider: server.provider,
								javaInstallation: server.java_installation,
								globalDefault: javaDefaultRef.current,
								runtimes: runtimesRef.current,
							});

							if (resolution.status !== 'resolved') {
								setServerStatus(server.id, 'offline');
								updateServerStats(server.id, offlineStats());
								livenessRef.current.delete(server.id);
								return;
							}

							entry.lastRestartAt = now;
							entry.everRunning = false;
							entry.nonOfflineSince = now;
							setServerStatus(server.id, 'starting');
							updateServerStats(server.id, { ...offlineStats(), uptime: new Date() });
							try {
								await invoke('start_server', {
									directory: server.directory,
									javaExecutable: resolution.executablePath,
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
