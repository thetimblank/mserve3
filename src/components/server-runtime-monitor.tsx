/**
 * App-wide runtime monitor for servers that are *not* currently open on their
 * detail page. The backend supervisor is the single source of truth for server
 * state and telemetry; this component is a pure consumer of its events:
 *
 *  - `server-runtime-state`: drives each server's status and recovers boot
 *    failures (shared with the page through `lib/server-start-recovery`).
 *  - `server-telemetry`: keeps dashboard/network stats fresh.
 *  - `server-output`: only used to flag why a boot failed.
 *  - `server-backups-changed`: rescans a server's backups after an automatic
 *    backup (for every server, open or not).
 *  - on mount / when servers change: a one-shot `get_server_runtime` snapshot per
 *    unclaimed server syncs initial state and adopts any already-running server.
 *
 * Servers claimed by an open detail page ({@link isServerRuntimeClaimed}) are
 * skipped for lifecycle handling so the two loops never fight over a status.
 */
import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';

import { useServers, type Server } from '@/data/servers';
import { useUser } from '@/data/user';
import { useJavaRuntimes } from '@/data/java-runtimes';
import { useJavaDownload } from '@/data/java-download';
import { isServerRuntimeClaimed } from '@/lib/server-runtime-registry';
import {
	mapRuntimeStateToStatus,
	mapSampleToStats,
	offlineServerStats,
	startingServerStats,
} from '@/lib/server-telemetry';
import { getErrorMessage, stripAnsi } from '@/lib/utils';
import { setServerJavaInstallation } from '@/lib/java-runtime-service';
import { scanServerContents } from '@/lib/server-contents';
import {
	createResolvedStartRecovery,
	hasFlaggedBootFailure,
	noteRecoveryOnline,
	noteRecoveryOutput,
	recoverFromBootCrash,
	type StartRecovery,
} from '@/lib/server-start-recovery';
import type {
	ServerBackupsChangedEvent,
	ServerOutputEvent,
	ServerRuntimeSnapshot,
	ServerRuntimeStateEvent,
	ServerTelemetryEvent,
} from '@/pages/server/server-types';
import { BACKUP_STORAGE_LIMIT_ERROR_PREFIX, notifyDeletedBackups } from '@/pages/server/server-utils';

export const ServerRuntimeMonitor: React.FC = () => {
	const { servers, setServerStatus, updateServer, updateServerStats } = useServers();
	const { user } = useUser();
	const { runtimes } = useJavaRuntimes();
	const { ensureJava } = useJavaDownload();

	// Latest values kept in refs so the event listeners don't re-subscribe on
	// every stats update.
	const serversRef = React.useRef(servers);
	serversRef.current = servers;
	const envRef = React.useRef({ globalDefault: user.java_installation_default, runtimes, ensureJava });
	envRef.current = { globalDefault: user.java_installation_default, runtimes, ensureJava };

	// Start-failure recovery per server, for the current start cycle.
	const recoveriesRef = React.useRef<Map<string, StartRecovery>>(new Map());
	const syncedRef = React.useRef<Set<string>>(new Set());
	// Servers that got a lifecycle event since their snapshot was requested.
	const stateEventSeenRef = React.useRef<Set<string>>(new Set());

	const getRecovery = React.useCallback((server: Server): StartRecovery => {
		let recovery = recoveriesRef.current.get(server.id);
		if (!recovery) {
			recovery = createResolvedStartRecovery(server, envRef.current);
			recoveriesRef.current.set(server.id, recovery);
		}
		return recovery;
	}, []);

	// Flag wrong-Java and unsupported-`--nogui` errors as they stream.
	React.useEffect(() => {
		let active = true;
		let unlisten: UnlistenFn | null = null;

		listen<ServerOutputEvent>('server-output', (event) => {
			if (!active) return;
			if (event.payload.stream !== 'stdout' && event.payload.stream !== 'stderr') return;

			const server = serversRef.current.find((item) => item.directory === event.payload.directory);
			if (!server) return;
			if (isServerRuntimeClaimed(server.id)) return;

			noteRecoveryOutput(getRecovery(server), server, stripAnsi(event.payload.line));
		})
			.then((cleanup) => {
				if (!active) cleanup();
				else unlisten = cleanup;
			})
			.catch(() => {});

		return () => {
			active = false;
			if (unlisten) unlisten();
		};
	}, [getRecovery]);

	// Authoritative lifecycle state.
	React.useEffect(() => {
		let active = true;
		let unlisten: UnlistenFn | null = null;

		const startWith = (server: Server, javaExecutable: string) => {
			setServerStatus(server.id, 'starting');
			updateServerStats(server.id, startingServerStats());
			void invoke('start_server', { directory: server.directory, javaExecutable }).catch((err) => {
				if (!active) return;
				setServerStatus(server.id, 'offline');
				updateServerStats(server.id, offlineServerStats());
				recoveriesRef.current.delete(server.id);
				toast.error(`${server.name}: ${getErrorMessage(err, "couldn't restart.")}`);
			});
		};

		const handleCrash = async (server: Server, exitCode: number | null) => {
			const recovery = getRecovery(server);
			const env = envRef.current;
			const outcome = await recoverFromBootCrash(recovery, server, {
				globalDefault: env.globalDefault,
				runtimes: env.runtimes,
				ensureJava: env.ensureJava,
				updateServer,
				report: (message) => toast.info(`${server.name}: ${message}`),
			});
			if (!active) return;
			if (outcome.kind === 'retry') {
				startWith(server, outcome.executablePath);
				return;
			}

			recoveriesRef.current.delete(server.id);
			setServerStatus(server.id, 'crashed');
			updateServerStats(server.id, offlineServerStats());
			toast.error(
				outcome.kind === 'failed'
					? `${server.name}: ${outcome.message}`
					: exitCode != null
						? `${server.name} crashed (exit code ${exitCode}).`
						: `${server.name} crashed.`,
			);
		};

		listen<ServerRuntimeStateEvent>('server-runtime-state', (event) => {
			if (!active) return;
			const { directory, state, exitCode, serverPort } = event.payload;
			const server = serversRef.current.find((item) => item.directory === directory);
			if (!server) return;
			if (isServerRuntimeClaimed(server.id)) return;
			// Newer than any snapshot still in flight for this server.
			stateEventSeenRef.current.add(server.id);

			// The supervisor knows the port the server is actually bound to (it may
			// have been reassigned on start when the configured one was taken).
			if (serverPort != null && serverPort !== server.telemetry_port) {
				updateServer(server.id, { telemetry_port: serverPort });
			}

			if (state === 'online' || state === 'running-external') {
				const pinned = noteRecoveryOnline(getRecovery(server), server);
				setServerStatus(server.id, 'online');
				updateServerStats(server.id, {
					online: true,
					uptime: server.stats.uptime ?? new Date(),
				});
				// Pin a Java we had to step down to find, so next time is instant.
				if (pinned) {
					void setServerJavaInstallation(server.directory, pinned)
						.then(() => updateServer(server.id, { java_installation: pinned }))
						.catch(() => {});
				}
				return;
			}

			if (state === 'starting') {
				getRecovery(server);
				setServerStatus(server.id, 'starting');
				return;
			}
			if (state === 'stopping') {
				setServerStatus(server.id, 'closing');
				return;
			}
			if (state === 'sleeping') {
				// The backend now holds the port with a wake listener; a wake starts a
				// fresh cycle.
				recoveriesRef.current.delete(server.id);
				setServerStatus(server.id, 'sleeping');
				updateServerStats(server.id, offlineServerStats());
				return;
			}

			// Auto-restart (including crash-loop guarding) lives in the Rust
			// supervisor, so it keeps working with the app window closed. The monitor
			// only reflects the resulting state and recovers boot failures.
			const recovery = recoveriesRef.current.get(server.id);
			if (state === 'crashed' || (recovery && hasFlaggedBootFailure(recovery))) {
				void handleCrash(server, exitCode);
				return;
			}

			recoveriesRef.current.delete(server.id);
			setServerStatus(server.id, 'offline');
			updateServerStats(server.id, offlineServerStats());
		})
			.then((cleanup) => {
				if (!active) cleanup();
				else unlisten = cleanup;
			})
			.catch(() => {});

		return () => {
			active = false;
			if (unlisten) unlisten();
		};
	}, [getRecovery, setServerStatus, updateServer, updateServerStats]);

	// Live telemetry → stats.
	React.useEffect(() => {
		let active = true;
		let unlisten: UnlistenFn | null = null;

		listen<ServerTelemetryEvent>('server-telemetry', (event) => {
			if (!active) return;
			const server = serversRef.current.find((item) => item.directory === event.payload.directory);
			if (!server) return;
			if (isServerRuntimeClaimed(server.id)) return;
			updateServerStats(
				server.id,
				mapSampleToStats(event.payload.sample, { fallbackUptime: server.stats.uptime }),
			);
		})
			.then((cleanup) => {
				if (!active) cleanup();
				else unlisten = cleanup;
			})
			.catch(() => {});

		return () => {
			active = false;
			if (unlisten) unlisten();
		};
	}, [updateServerStats]);

	// An automatic backup finished (or failed) in the backend: refresh that
	// server's backup list, whether or not its page is open.
	React.useEffect(() => {
		let active = true;
		let unlisten: UnlistenFn | null = null;

		listen<ServerBackupsChangedEvent>('server-backups-changed', (event) => {
			if (!active) return;
			const { directory, deletedBackupsCount, error } = event.payload;
			const server = serversRef.current.find((item) => item.directory === directory);
			if (!server) return;

			if (error) {
				// One toast per server that replaces itself, so a failing interval
				// backup doesn't stack a new toast every few minutes.
				toast.error(
					`${server.name}: auto backup failed. ${error}`,
					error.startsWith(BACKUP_STORAGE_LIMIT_ERROR_PREFIX)
						? { duration: Infinity, id: 'backup-storage-limit' }
						: { id: `auto-backup-failed-${server.id}` },
				);
				return;
			}
			notifyDeletedBackups(deletedBackupsCount);
			void scanServerContents(directory)
				.then((update) => {
					if (active) updateServer(server.id, update);
				})
				.catch(() => {});
		})
			.then((cleanup) => {
				if (!active) cleanup();
				else unlisten = cleanup;
			})
			.catch(() => {});

		return () => {
			active = false;
			if (unlisten) unlisten();
		};
	}, [updateServer]);

	// One-shot snapshot per server to sync initial state and adopt any server
	// already running (e.g. the app was restarted while servers were up).
	// `servers` changes as each snapshot lands, so a re-run must not discard the
	// ones still in flight — they're already marked synced and won't be retried.
	const mountedRef = React.useRef(true);
	React.useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	React.useEffect(() => {
		void Promise.all(
			serversRef.current.map(async (server) => {
				if (isServerRuntimeClaimed(server.id)) return;
				if (syncedRef.current.has(server.id)) return;
				syncedRef.current.add(server.id);
				stateEventSeenRef.current.delete(server.id);
				try {
					const snapshot = await invoke<ServerRuntimeSnapshot>('get_server_runtime', {
						directory: server.directory,
					});
					// A lifecycle event that landed meanwhile is newer than this snapshot.
					if (!mountedRef.current || stateEventSeenRef.current.has(server.id)) return;
					setServerStatus(server.id, mapRuntimeStateToStatus(snapshot.state));
					if (snapshot.serverPort != null && snapshot.serverPort !== server.telemetry_port) {
						updateServer(server.id, { telemetry_port: snapshot.serverPort });
					}
					if (snapshot.state === 'online' || snapshot.state === 'running-external') {
						getRecovery(server).everRunning = true;
					}
					if (snapshot.sample) {
						updateServerStats(
							server.id,
							mapSampleToStats(snapshot.sample, { fallbackUptime: server.stats.uptime }),
						);
					} else if (snapshot.state === 'offline') {
						updateServerStats(server.id, offlineServerStats());
					}
				} catch {
					// Backend unavailable; the next servers change retries.
					syncedRef.current.delete(server.id);
				}
			}),
		);
	}, [servers, getRecovery, setServerStatus, updateServer, updateServerStats]);

	return null;
};
