import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import type { Server, ServerStatus, ServerUpdate } from '@/data/servers';
import { stripAnsi, getErrorMessage } from '@/lib/utils';
import {
	mapRuntimeStateToStatus,
	mapSampleToStats,
	offlineServerStats,
	startingServerStats,
} from '@/lib/server-telemetry';
import { useUser } from '@/data/user';
import { useJavaRuntimes } from '@/data/java-runtimes';
import { useJavaDownload } from '@/data/java-download';
import { resolveServerJavaExecutable } from '@/lib/java-resolution';
import { setServerJavaInstallation } from '@/lib/java-runtime-service';
import { scanServerContents } from '@/lib/server-contents';
import {
	createResolvedStartRecovery,
	createStartRecovery,
	hasFlaggedBootFailure,
	noteRecoveryOnline,
	noteRecoveryOutput,
	recoverFromBootCrash,
	type StartRecovery,
} from '@/lib/server-start-recovery';
import {
	type CrashInfo,
	type ServerOutputEvent,
	type ServerRuntimeSnapshot,
	type ServerRuntimeStateEvent,
	type ServerTelemetryEvent,
} from '../server-types';
import { isStopCommand } from '../server-utils';
import { claimServerRuntime, releaseServerRuntime } from '@/lib/server-runtime-registry';

type Args = {
	server: Server | undefined;
	serverId: string;
	isBusy: boolean;
	setIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
	terminalInput: string;
	setTerminalInput: React.Dispatch<React.SetStateAction<string>>;
	setErrorMessage: React.Dispatch<React.SetStateAction<string | null>>;
	setServerStatus: (id: string, status: ServerStatus) => void;
	updateServer: (id: string, update: ServerUpdate) => void;
	updateServerStats: (id: string, stats: Partial<Server['stats']>) => void;
	appendTerminalLine: (line: string) => void;
};

type RuntimeState = {
	startAt: Date | null;
	lastOutputKey: string;
	lastOutputAt: number;
	/** Start-failure recovery for the current start cycle. */
	recovery: StartRecovery;
	/** A lifecycle event arrived after the startup snapshot was requested. */
	stateEventSeen: boolean;
};

const initialRuntimeState = (): RuntimeState => ({
	startAt: null,
	lastOutputKey: '',
	lastOutputAt: 0,
	recovery: createStartRecovery(),
	stateEventSeen: false,
});

/**
 * The server page's runtime loop: terminal output, authoritative lifecycle and
 * telemetry for the open server, and the user's start/stop/restart actions.
 * Start-failure recovery is shared with the app-wide monitor
 * (`lib/server-start-recovery`); automatic backups run in the backend supervisor.
 */
export const useServerRuntime = ({
	server,
	serverId,
	isBusy,
	setIsBusy,
	terminalInput,
	setTerminalInput,
	setErrorMessage,
	setServerStatus,
	updateServer,
	updateServerStats,
	appendTerminalLine,
}: Args) => {
	const { user } = useUser();
	const { runtimes: javaRuntimes } = useJavaRuntimes();
	const { ensureJava } = useJavaDownload();
	const runtimeRef = React.useRef<RuntimeState>(initialRuntimeState());
	const serverDirectory = server?.directory;
	const serverStatus = server?.status;
	const [lastCrash, setLastCrash] = React.useState<CrashInfo | null>(null);

	// Latest values for the event listeners, so they don't re-subscribe (and
	// miss events) whenever the server's config or stats change.
	const serverRef = React.useRef(server);
	serverRef.current = server;
	const recoveryEnvRef = React.useRef({ globalDefault: user.java_installation_default, javaRuntimes, ensureJava });
	recoveryEnvRef.current = { globalDefault: user.java_installation_default, javaRuntimes, ensureJava };

	const showError = React.useCallback(
		(error: unknown, fallback: string) => {
			const message = getErrorMessage(error, fallback);
			setErrorMessage(message);
			toast.error(message);
			return message;
		},
		[setErrorMessage],
	);

	const appendResolvedStartCommand = React.useCallback(
		async (javaExecutable: string) => {
			if (!serverDirectory) return;

			try {
				const command = await invoke<string>('get_server_start_command', {
					directory: serverDirectory,
					javaExecutable,
				});
				appendTerminalLine(`[system] Running: ${command}`);
			} catch (error) {
				const message = getErrorMessage(error, 'Failed to resolve start command.');
				appendTerminalLine(`[system] ${message}`);
			}
		},
		[appendTerminalLine, serverDirectory],
	);

	const setOfflineState = React.useCallback(() => {
		setServerStatus(serverId, 'offline');
		runtimeRef.current.startAt = null;
		updateServerStats(serverId, offlineServerStats());
	}, [serverId, setServerStatus, updateServerStats]);

	/** Like {@link setOfflineState} but parks the server in the `crashed` status
	 * and records the crash details for the crash panel. */
	const setCrashedState = React.useCallback(
		(crash: CrashInfo) => {
			setServerStatus(serverId, 'crashed');
			runtimeRef.current.startAt = null;
			updateServerStats(serverId, offlineServerStats());
			setLastCrash(crash);
		},
		[serverId, setServerStatus, updateServerStats],
	);

	/** Clears the crash panel (user dismissed it) without changing status. */
	const dismissCrash = React.useCallback(() => setLastCrash(null), []);

	const setStartingState = React.useCallback(() => {
		runtimeRef.current.startAt = new Date();
		updateServerStats(serverId, { ...startingServerStats(), uptime: runtimeRef.current.startAt });
		setServerStatus(serverId, 'starting');
	}, [serverId, setServerStatus, updateServerStats]);

	// Resolves an installed compatible Java, or offers to download the
	// recommended one. Returns `null` when the user cancelled the download.
	const acquireJava = React.useCallback(async (): Promise<{
		executablePath: string;
		majorVersion: number | null;
	} | null> => {
		const resolution = resolveServerJavaExecutable({
			provider: server?.provider,
			javaInstallation: server?.java_installation,
			globalDefault: user.java_installation_default,
			runtimes: javaRuntimes,
		});
		if (resolution.status === 'resolved') {
			return { executablePath: resolution.executablePath, majorVersion: resolution.majorVersion };
		}
		const runtime = await ensureJava(resolution.requirement.recommendedMajor);
		return runtime ? { executablePath: runtime.executablePath, majorVersion: runtime.majorVersion } : null;
	}, [ensureJava, javaRuntimes, server?.java_installation, server?.provider, user.java_installation_default]);

	const startWithJava = React.useCallback(
		async (javaExecutable: string) => {
			if (!serverDirectory) return;
			await appendResolvedStartCommand(javaExecutable);
			await invoke('start_server', { directory: serverDirectory, javaExecutable });
		},
		[appendResolvedStartCommand, serverDirectory],
	);

	const syncServerContents = React.useCallback(async () => {
		if (!serverDirectory || !serverId) return;
		try {
			updateServer(serverId, await scanServerContents(serverDirectory));
		} catch {}
	}, [serverDirectory, serverId, updateServer]);

	React.useEffect(() => {
		setErrorMessage(null);
		runtimeRef.current = initialRuntimeState();
	}, [serverId, setErrorMessage]);

	// Claim this server while the detail page is open so the app-wide
	// ServerRuntimeMonitor defers its lifecycle handling to this richer loop.
	React.useEffect(() => {
		if (!serverId) return;
		claimServerRuntime(serverId);
		return () => releaseServerRuntime(serverId);
	}, [serverId]);

	React.useEffect(() => {
		void syncServerContents();
	}, [syncServerContents]);

	// Sync initial state once (covers opening the page on an already-running or
	// externally-running server). A lifecycle event that lands first is newer.
	React.useEffect(() => {
		if (!serverDirectory || !serverId) return;
		let active = true;
		runtimeRef.current.stateEventSeen = false;
		void (async () => {
			try {
				const snapshot = await invoke<ServerRuntimeSnapshot>('get_server_runtime', {
					directory: serverDirectory,
				});
				if (!active || runtimeRef.current.stateEventSeen) return;
				setServerStatus(serverId, mapRuntimeStateToStatus(snapshot.state));
				if (snapshot.serverPort != null && snapshot.serverPort !== serverRef.current?.telemetry_port) {
					updateServer(serverId, { telemetry_port: snapshot.serverPort });
				}
				if (snapshot.state === 'online' || snapshot.state === 'running-external') {
					runtimeRef.current.recovery.everRunning = true;
					if (!runtimeRef.current.startAt) {
						runtimeRef.current.startAt = snapshot.startedAt ? new Date(snapshot.startedAt) : new Date();
					}
				}
				if (snapshot.sample) {
					updateServerStats(
						serverId,
						mapSampleToStats(snapshot.sample, { fallbackUptime: runtimeRef.current.startAt }),
					);
				}
			} catch {}
		})();
		return () => {
			active = false;
		};
	}, [serverDirectory, serverId, setServerStatus, updateServer, updateServerStats]);

	// Console output: terminal display + flagging boot-failure causes.
	React.useEffect(() => {
		if (!serverDirectory) return;
		if (!serverId) return;

		let unlisten: UnlistenFn | null = null;
		let active = true;

		listen<ServerOutputEvent>('server-output', (event) => {
			if (!active) return;
			if (event.payload.directory !== serverDirectory) return;
			const stream = event.payload.stream;

			// Lines the backend writes to explain its own actions (sleep, wake,
			// auto backups, port changes).
			if (stream === 'system') {
				appendTerminalLine(`[system] ${event.payload.line}`);
				return;
			}
			if (stream !== 'stdout' && stream !== 'stderr') return;

			const cleaned = stripAnsi(event.payload.line);
			const dedupeKey = `${stream}:${cleaned}`;
			const now = Date.now();
			if (runtimeRef.current.lastOutputKey === dedupeKey && now - runtimeRef.current.lastOutputAt < 250) {
				return;
			}

			runtimeRef.current.lastOutputKey = dedupeKey;
			runtimeRef.current.lastOutputAt = now;

			const current = serverRef.current;
			if (current) noteRecoveryOutput(runtimeRef.current.recovery, current, cleaned);

			if (!cleaned) {
				return;
			}

			appendTerminalLine(`[${stream}] ${cleaned}`);
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
			if (unlisten) {
				unlisten();
			}
		};
	}, [appendTerminalLine, serverDirectory, serverId]);

	// Authoritative lifecycle state from the backend supervisor.
	React.useEffect(() => {
		if (!serverDirectory || !serverId) return;

		let unlisten: UnlistenFn | null = null;
		let active = true;

		const handleCrash = async (exitCode: number | null, stderrTail: string[]) => {
			const current = serverRef.current;
			const env = recoveryEnvRef.current;
			const outcome = current
				? await recoverFromBootCrash(runtimeRef.current.recovery, current, {
						globalDefault: env.globalDefault,
						runtimes: env.javaRuntimes,
						ensureJava: env.ensureJava,
						updateServer,
						report: (message) => appendTerminalLine(`[system] ${message}`),
					})
				: ({ kind: 'none' } as const);
			if (!active) return;

			if (outcome.kind === 'retry') {
				setStartingState();
				try {
					await startWithJava(outcome.executablePath);
				} catch (err) {
					setOfflineState();
					appendTerminalLine(`[system] ${getErrorMessage(err, 'Failed to start the server again.')}`);
				}
				return;
			}

			runtimeRef.current.recovery = createStartRecovery();
			if (outcome.kind === 'failed') {
				appendTerminalLine(`[system] ${outcome.message}`);
				setErrorMessage(outcome.message);
				toast.error(outcome.message);
			}
			appendTerminalLine(
				exitCode != null ? `[system] Server crashed (exit code ${exitCode}).` : '[system] Server crashed.',
			);
			setCrashedState({ exitCode, stderrTail, at: new Date() });
		};

		listen<ServerRuntimeStateEvent>('server-runtime-state', (event) => {
			if (!active) return;
			if (event.payload.directory !== serverDirectory) return;
			const { state, exitCode, startedAt, serverPort, stderrTail } = event.payload;
			runtimeRef.current.stateEventSeen = true;

			// The supervisor knows the port the server is actually bound to (it may
			// have been reassigned on start when the configured one was taken).
			if (serverPort != null && serverPort !== serverRef.current?.telemetry_port) {
				updateServer(serverId, { telemetry_port: serverPort });
			}

			if (state === 'online' || state === 'running-external') {
				const current = serverRef.current;
				const pinned = current ? noteRecoveryOnline(runtimeRef.current.recovery, current) : null;
				setLastCrash(null);
				if (!runtimeRef.current.startAt) {
					runtimeRef.current.startAt = startedAt ? new Date(startedAt) : new Date();
				}
				setServerStatus(serverId, 'online');
				updateServerStats(serverId, { online: true, uptime: runtimeRef.current.startAt });

				// The current Java worked after a step-down: pin it.
				if (pinned) {
					void setServerJavaInstallation(serverDirectory, pinned)
						.then(() => {
							updateServer(serverId, { java_installation: pinned });
							appendTerminalLine('[system] Saved this Java version for the server.');
						})
						.catch(() => {});
				}
				return;
			}

			if (state === 'starting') {
				// A start this page didn't make (auto-restart, sleep wake) is a new cycle.
				const current = serverRef.current;
				if (current && runtimeRef.current.recovery.everRunning) {
					const env = recoveryEnvRef.current;
					runtimeRef.current.recovery = createResolvedStartRecovery(current, {
						globalDefault: env.globalDefault,
						runtimes: env.javaRuntimes,
					});
				}
				if (!runtimeRef.current.startAt) runtimeRef.current.startAt = new Date();
				setLastCrash(null);
				setServerStatus(serverId, 'starting');
				return;
			}

			if (state === 'stopping') {
				setServerStatus(serverId, 'closing');
				return;
			}

			if (state === 'sleeping') {
				// The process is down but mserve holds the port with a wake listener.
				runtimeRef.current.recovery = createStartRecovery();
				runtimeRef.current.startAt = null;
				setServerStatus(serverId, 'sleeping');
				updateServerStats(serverId, offlineServerStats());
				return;
			}

			// Backend auto-restart (with crash-loop guarding) lives in the Rust
			// supervisor, so it keeps working with the app window closed. The page
			// only reflects the resulting state and recovers boot failures.
			if (state === 'crashed' || hasFlaggedBootFailure(runtimeRef.current.recovery)) {
				void handleCrash(exitCode, stderrTail ?? []);
				return;
			}

			runtimeRef.current.recovery = createStartRecovery();
			setOfflineState();
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
	}, [
		appendTerminalLine,
		serverDirectory,
		serverId,
		setCrashedState,
		setErrorMessage,
		setOfflineState,
		setServerStatus,
		setStartingState,
		startWithJava,
		updateServer,
		updateServerStats,
	]);

	// Live telemetry → stats.
	React.useEffect(() => {
		if (!serverDirectory || !serverId) return;

		let unlisten: UnlistenFn | null = null;
		let active = true;

		listen<ServerTelemetryEvent>('server-telemetry', (event) => {
			if (!active) return;
			if (event.payload.directory !== serverDirectory) return;
			updateServerStats(
				serverId,
				mapSampleToStats(event.payload.sample, { fallbackUptime: runtimeRef.current.startAt }),
			);
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
	}, [serverDirectory, serverId, updateServerStats]);

	const handleStart = React.useCallback(async () => {
		if (!serverDirectory) return;
		if (isBusy) return;

		setIsBusy(true);
		setStartingState();
		appendTerminalLine('[system] Starting server...');

		try {
			const java = await acquireJava();
			if (!java) {
				setOfflineState();
				appendTerminalLine('[system] Start cancelled — no Java runtime available.');
				return;
			}

			runtimeRef.current.recovery = createStartRecovery(java.executablePath, java.majorVersion);
			await startWithJava(java.executablePath);
			await syncServerContents();
		} catch (err) {
			setOfflineState();
			const message = showError(err, 'Failed to start server.');
			appendTerminalLine(`[system] ${message}`);
		} finally {
			setIsBusy(false);
		}
	}, [
		acquireJava,
		appendTerminalLine,
		isBusy,
		serverDirectory,
		setIsBusy,
		setOfflineState,
		setStartingState,
		showError,
		startWithJava,
		syncServerContents,
	]);

	const handleStop = React.useCallback(async () => {
		if (!serverDirectory) return;
		if (isBusy) return;

		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		appendTerminalLine('[system] Stopping server...');

		// The supervisor detects the actual exit and emits `offline`.
		try {
			await invoke('stop_server', { directory: serverDirectory });
		} catch (err) {
			setOfflineState();
			const message = getErrorMessage(err, 'Failed to stop server.');
			appendTerminalLine(`[system] ${message}`);
		} finally {
			setIsBusy(false);
		}
	}, [appendTerminalLine, isBusy, serverDirectory, serverId, setIsBusy, setOfflineState, setServerStatus]);

	const handleSleep = React.useCallback(async () => {
		if (!serverDirectory) return;
		if (isBusy) return;

		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		appendTerminalLine('[system] Putting server to sleep...');

		try {
			await invoke('sleep_server', { directory: serverDirectory });
			// Leave the status `closing`; the `server-runtime-state` event (sleeping,
			// or offline if sleep mode failed to start) corrects it once the process
			// actually exits.
		} catch (err) {
			// The backend rejected the request before touching the process, so
			// it's still online.
			setServerStatus(serverId, 'online');
			const message = showError(err, 'Failed to put server to sleep.');
			appendTerminalLine(`[system] ${message}`);
		} finally {
			setIsBusy(false);
		}
	}, [appendTerminalLine, isBusy, serverDirectory, serverId, setIsBusy, setServerStatus, showError]);

	const handleRestart = React.useCallback(async () => {
		if (!serverDirectory) return;
		if (isBusy) return;

		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		appendTerminalLine('[system] Restarting server...');

		try {
			const java = await acquireJava();
			if (!java) {
				setOfflineState();
				appendTerminalLine('[system] Restart cancelled — no Java runtime available.');
				return;
			}

			runtimeRef.current.recovery = createStartRecovery(java.executablePath, java.majorVersion);
			await appendResolvedStartCommand(java.executablePath);
			// The backend stops, waits for exit, then starts; events do the rest.
			await invoke('restart_server', { directory: serverDirectory, javaExecutable: java.executablePath });
		} catch (err) {
			setOfflineState();
			const message = showError(err, 'Failed to restart server.');
			appendTerminalLine(`[system] ${message}`);
		} finally {
			setIsBusy(false);
		}
	}, [
		acquireJava,
		appendResolvedStartCommand,
		appendTerminalLine,
		isBusy,
		serverDirectory,
		serverId,
		setIsBusy,
		setOfflineState,
		setServerStatus,
		showError,
	]);

	const handleForceKill = React.useCallback(async () => {
		if (!serverDirectory) return;
		if (isBusy) return;

		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		appendTerminalLine('[system] Force killing server process...');

		try {
			const message = await invoke<string>('force_kill_server', { directory: serverDirectory });
			appendTerminalLine(`[system] ${message}`);
		} catch (err) {
			setOfflineState();
			const message = showError(err, 'Failed to force kill server process.');
			appendTerminalLine(`[system] ${message}`);
		} finally {
			setIsBusy(false);
		}
	}, [appendTerminalLine, isBusy, serverDirectory, serverId, setIsBusy, setOfflineState, setServerStatus, showError]);

	const handleTerminalCommandSubmit = React.useCallback(
		async (event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (!serverDirectory) return;
			if (serverStatus === 'offline' || serverStatus === 'closing' || isBusy) return;

			const command = terminalInput.trim();
			if (!command) return;

			setTerminalInput('');
			appendTerminalLine(`> ${command}`);

			if (isStopCommand(command, server?.provider)) {
				setServerStatus(serverId, 'closing');
			}

			try {
				await invoke('send_server_command', {
					directory: serverDirectory,
					command,
				});
			} catch (err) {
				const message = showError(err, 'Failed to send command.');
				appendTerminalLine(`[system] ${message}`);
			}
		},
		[
			appendTerminalLine,
			isBusy,
			server?.provider,
			serverDirectory,
			serverStatus,
			serverId,
			setServerStatus,
			setTerminalInput,
			showError,
			terminalInput,
		],
	);

	return {
		syncServerContents,
		handleStart,
		handleStop,
		handleSleep,
		handleRestart,
		handleForceKill,
		handleTerminalCommandSubmit,
		lastCrash,
		dismissCrash,
	};
};
