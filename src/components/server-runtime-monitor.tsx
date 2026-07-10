/**
 * App-wide runtime monitor for servers that are *not* currently open on their
 * detail page. The backend supervisor is the single source of truth for server
 * state and telemetry; this component is a pure consumer of its events:
 *
 *  - `server-runtime-state`: drives each server's status, handles wrong-Java
 *    step-down and auto-restart on crash, and pins a working Java once found.
 *  - `server-telemetry`: keeps dashboard/network stats fresh.
 *  - `server-output`: only used to flag a wrong-Java error early so the crash
 *    handler knows why a boot failed.
 *  - on mount / when servers change: a one-shot `get_server_runtime` snapshot per
 *    unclaimed server syncs initial state and adopts any already-running server.
 *
 * Servers claimed by an open detail page ({@link isServerRuntimeClaimed}) are
 * skipped here so the two loops never fight over the same server's status.
 */
import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';

import { useServers } from '@/data/servers';
import { useUser } from '@/data/user';
import { useJavaRuntimes } from '@/data/java-runtimes';
import { isServerRuntimeClaimed } from '@/lib/server-runtime-registry';
import {
	mapRuntimeStateToStatus,
	mapSampleToStats,
	offlineServerStats,
	startingServerStats,
} from '@/lib/server-telemetry';
import { isJavaVersionError, isNoguiUnsupportedError, stripAnsi } from '@/lib/utils';
import { planJavaFallback, resolveServerJavaExecutable } from '@/lib/java-resolution';
import { setServerJavaInstallation, type JavaRuntimeInfo } from '@/lib/java-runtime-service';
import { hasNoguiFlag, setServerCustomFlags, stripNoguiFlags } from '@/lib/server-flags-service';
import type {
	ServerOutputEvent,
	ServerRuntimeSnapshot,
	ServerRuntimeStateEvent,
	ServerTelemetryEvent,
} from '@/pages/server/server-types';

// Per-server bookkeeping for the background lifecycle handling.
type RuntimeEntry = {
	everRunning: boolean;
	lastRestartAt: number;
	// Wrong-Java step-down state.
	javaErrorFlagged: boolean;
	attemptedMajors: number[];
	didFallback: boolean;
	lastExecutable: string | null;
	// Unsupported-`--nogui` strip-and-retry state.
	noguiErrorFlagged: boolean;
	noguiStripAttempted: boolean;
};

export const ServerRuntimeMonitor: React.FC = () => {
	const { servers, setServerStatus, updateServer, updateServerStats } = useServers();
	const { user } = useUser();
	const { runtimes } = useJavaRuntimes();

	// Latest values kept in refs so the event listeners don't re-subscribe on
	// every stats update.
	const serversRef = React.useRef(servers);
	serversRef.current = servers;
	const javaDefaultRef = React.useRef(user.java_installation_default);
	javaDefaultRef.current = user.java_installation_default;
	const runtimesRef = React.useRef<JavaRuntimeInfo[]>(runtimes);
	runtimesRef.current = runtimes;

	const entriesRef = React.useRef<Map<string, RuntimeEntry>>(new Map());
	const syncedRef = React.useRef<Set<string>>(new Set());

	const getEntry = React.useCallback((id: string): RuntimeEntry => {
		let entry = entriesRef.current.get(id);
		if (!entry) {
			entry = {
				everRunning: false,
				lastRestartAt: 0,
				javaErrorFlagged: false,
				attemptedMajors: [],
				didFallback: false,
				lastExecutable: null,
				noguiErrorFlagged: false,
				noguiStripAttempted: false,
			};
			entriesRef.current.set(id, entry);
		}
		return entry;
	}, []);

	// Flag wrong-Java and unsupported-`--nogui` errors as they stream so the crash
	// handler can step down / strip the flag.
	React.useEffect(() => {
		let active = true;
		let unlisten: UnlistenFn | null = null;

		listen<ServerOutputEvent>('server-output', (event) => {
			if (!active) return;
			if (event.payload.stream !== 'stdout' && event.payload.stream !== 'stderr') return;

			const server = serversRef.current.find((item) => item.directory === event.payload.directory);
			if (!server) return;
			if (isServerRuntimeClaimed(server.id)) return;

			const line = stripAnsi(event.payload.line);

			// Unlike the Java step-down, this applies regardless of a pinned Java —
			// the flag is rejected by the jar, not the runtime.
			if (isNoguiUnsupportedError(line)) {
				const entry = getEntry(server.id);
				if (!entry.everRunning) entry.noguiErrorFlagged = true;
			}

			// A pinned Java is the user's explicit choice — never auto-step-down.
			if ((server.java_installation ?? '').trim() !== '') return;

			if (isJavaVersionError(line)) {
				const entry = getEntry(server.id);
				if (!entry.everRunning) entry.javaErrorFlagged = true;
			}
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
	}, [getEntry]);

	// Authoritative lifecycle state.
	React.useEffect(() => {
		let active = true;
		let unlisten: UnlistenFn | null = null;

		const startWith = (server: { id: string; directory: string }, javaExecutable: string) => {
			setServerStatus(server.id, 'starting');
			updateServerStats(server.id, startingServerStats());
			void invoke('start_server', { directory: server.directory, javaExecutable }).catch(() => {
				if (!active) return;
				setServerStatus(server.id, 'offline');
				updateServerStats(server.id, offlineServerStats());
			});
		};

		listen<ServerRuntimeStateEvent>('server-runtime-state', (event) => {
			if (!active) return;
			const { directory, state, exitCode, serverPort } = event.payload;
			const server = serversRef.current.find((item) => item.directory === directory);
			if (!server) return;
			if (isServerRuntimeClaimed(server.id)) return;

			// The supervisor knows the port the server is actually bound to (it may
			// have been reassigned on start when the configured one was taken).
			if (serverPort != null && serverPort !== server.telemetry_port) {
				updateServer(server.id, { telemetry_port: serverPort });
			}

			const entry = getEntry(server.id);

			if (state === 'online' || state === 'running-external') {
				entry.everRunning = true;
				entry.javaErrorFlagged = false;
				entry.noguiErrorFlagged = false;
				setServerStatus(server.id, 'online');
				updateServerStats(server.id, {
					online: true,
					uptime: server.stats.uptime ?? new Date(),
				});
				// Pin a Java we had to step down to find, so next time is instant.
				if (entry.didFallback && entry.lastExecutable && (server.java_installation ?? '').trim() === '') {
					const pinned = entry.lastExecutable;
					void setServerJavaInstallation(server.directory, pinned)
						.then(() => updateServer(server.id, { java_installation: pinned }))
						.catch(() => {});
				}
				entry.didFallback = false;
				entry.lastExecutable = null;
				entry.attemptedMajors = [];
				return;
			}

			if (state === 'starting') {
				setServerStatus(server.id, 'starting');
				return;
			}
			if (state === 'stopping') {
				setServerStatus(server.id, 'closing');
				return;
			}
			if (state === 'sleeping') {
				// The backend now holds the port with a wake listener; reflect it and
				// keep the entry so a later wake/crash is handled normally.
				setServerStatus(server.id, 'sleeping');
				updateServerStats(server.id, offlineServerStats());
				return;
			}

			// offline or crashed.
			const noPinnedJava = (server.java_installation ?? '').trim() === '';

			// Unsupported `--nogui`: drop the flag and retry once, before the crash
			// is surfaced. Only when it never came up and we saw the error.
			if (
				state === 'crashed' &&
				entry.noguiErrorFlagged &&
				!entry.noguiStripAttempted &&
				!entry.everRunning &&
				hasNoguiFlag(server.custom_flags ?? [])
			) {
				entry.noguiErrorFlagged = false;
				entry.noguiStripAttempted = true;

				const resolution = resolveServerJavaExecutable({
					provider: server.provider,
					javaInstallation: server.java_installation,
					globalDefault: javaDefaultRef.current,
					runtimes: runtimesRef.current,
				});

				if (resolution.status === 'resolved') {
					const nextFlags = stripNoguiFlags(server.custom_flags ?? []);
					const executablePath = resolution.executablePath;
					void setServerCustomFlags(server.directory, nextFlags)
						.then(() => {
							if (!active) return;
							updateServer(server.id, { custom_flags: nextFlags });
							toast.info(`${server.name} doesn't support '--nogui' — removed it and restarted.`);
							startWith(server, executablePath);
						})
						.catch(() => {
							if (!active) return;
							setServerStatus(server.id, 'crashed');
							updateServerStats(server.id, offlineServerStats());
						});
					return;
				}
			}

			// Wrong-Java step-down: only when it never came up and we saw the error.
			if (state === 'crashed' && entry.javaErrorFlagged && !entry.everRunning && noPinnedJava) {
				entry.javaErrorFlagged = false;
				const plan = planJavaFallback({
					provider: server.provider,
					globalDefault: javaDefaultRef.current,
					runtimes: runtimesRef.current,
					attemptedMajors: entry.attemptedMajors,
				});
				if (plan.kind === 'retry') {
					entry.attemptedMajors.push(plan.majorVersion);
					entry.didFallback = true;
					entry.lastExecutable = plan.executablePath;
					entry.lastRestartAt = Date.now();
					startWith(server, plan.executablePath);
					return;
				}
				// No installed Java worked — the detail page offers a download.
				setServerStatus(server.id, 'offline');
				updateServerStats(server.id, offlineServerStats());
				entriesRef.current.delete(server.id);
				toast.error(`${server.name} couldn't start: no compatible Java runtime.`);
				return;
			}

			// Auto-restart (including crash-loop guarding) now lives in the Rust
			// supervisor, so it keeps working with the app window closed. The monitor
			// only reflects the resulting state.
			if (state === 'crashed') {
				setServerStatus(server.id, 'crashed');
				updateServerStats(server.id, offlineServerStats());
				toast.error(
					exitCode != null ? `${server.name} crashed (exit code ${exitCode}).` : `${server.name} crashed.`,
				);
				entriesRef.current.delete(server.id);
				return;
			}

			setServerStatus(server.id, 'offline');
			updateServerStats(server.id, offlineServerStats());
			entriesRef.current.delete(server.id);
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
	}, [getEntry, setServerStatus, updateServer, updateServerStats]);

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

	// One-shot snapshot per server to sync initial state and adopt any server
	// already running (e.g. the app was restarted while servers were up).
	React.useEffect(() => {
		let active = true;

		void Promise.all(
			serversRef.current.map(async (server) => {
				if (isServerRuntimeClaimed(server.id)) return;
				if (syncedRef.current.has(server.id)) return;
				syncedRef.current.add(server.id);
				try {
					const snapshot = await invoke<ServerRuntimeSnapshot>('get_server_runtime', {
						directory: server.directory,
					});
					if (!active) return;
					setServerStatus(server.id, mapRuntimeStateToStatus(snapshot.state));
					if (snapshot.serverPort != null && snapshot.serverPort !== server.telemetry_port) {
						updateServer(server.id, { telemetry_port: snapshot.serverPort });
					}
					if (snapshot.state === 'online' || snapshot.state === 'running-external') {
						getEntry(server.id).everRunning = true;
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

		return () => {
			active = false;
		};
	}, [servers, getEntry, setServerStatus, updateServer, updateServerStats]);

	return null;
};
