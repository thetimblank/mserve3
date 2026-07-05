import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import type { Server, ServerStatus, ServerUpdate } from '@/data/servers';
import { isJavaVersionError, stripAnsi } from '@/lib/utils';
import {
	mapRuntimeStateToStatus,
	mapSampleToStats,
	offlineServerStats,
	startingServerStats,
} from '@/lib/server-telemetry';
import { useUser } from '@/data/user';
import { useJavaRuntimes } from '@/data/java-runtimes';
import { useJavaDownload } from '@/data/java-download';
import { planJavaFallback, resolveServerJavaExecutable } from '@/lib/java-resolution';
import { setServerJavaInstallation } from '@/lib/java-runtime-service';
import {
	type CrashInfo,
	type CreateServerBackupResult,
	type ScanServerContentsResult,
	type ServerOutputEvent,
	type ServerRuntimeSnapshot,
	type ServerRuntimeStateEvent,
	type ServerTelemetryEvent,
} from '../server-types';
import { isStopCommand, makeCloseBackupKey, mapScannedBackups } from '../server-utils';
import { claimServerRuntime, releaseServerRuntime } from '@/lib/server-runtime-registry';
import { isProxyProvider } from '@/lib/server-provider';

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

type BackupReason = 'on_start' | 'on_close' | 'interval';

const BACKUP_STORAGE_LIMIT_ERROR_PREFIX = 'Backup storage limit exceeded';

type RuntimeState = {
	startAt: Date | null;
	lastOutputKey: string;
	lastOutputAt: number;
	stopRequested: boolean;
	restartRequested: boolean;
	manualStopRequested: boolean;
	forceKilled: boolean;
	everRunning: boolean;
	lastOnCloseBackupKey: string;
	isAutoRestarting: boolean;
	previousStatus: ServerStatus;
	isCreatingAutoBackup: boolean;
	// Automatic Java resolution + start-failure fallback.
	awaitingReady: boolean;
	currentJavaExecutable: string | null;
	javaAttemptMajors: number[];
	javaDidFallback: boolean;
	javaFallbackInProgress: boolean;
	javaDownloadAttempted: boolean;
	javaGiveUp: boolean;
};

const initialRuntimeState = (): RuntimeState => ({
	startAt: null,
	lastOutputKey: '',
	lastOutputAt: 0,
	stopRequested: false,
	restartRequested: false,
	manualStopRequested: false,
	forceKilled: false,
	everRunning: false,
	lastOnCloseBackupKey: '',
	isAutoRestarting: false,
	previousStatus: 'offline',
	isCreatingAutoBackup: false,
	awaitingReady: false,
	currentJavaExecutable: null,
	javaAttemptMajors: [],
	javaDidFallback: false,
	javaFallbackInProgress: false,
	javaDownloadAttempted: false,
	javaGiveUp: false,
});

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
	const serverTelemetryPort = server?.telemetry_port;

	const autoBackupModes = server?.auto_backup ?? [];
	const hasOnStartBackup = autoBackupModes.includes('on_start');
	const hasOnCloseBackup = autoBackupModes.includes('on_close');
	const hasIntervalBackup = autoBackupModes.includes('interval');
	const autoBackupIntervalMinutes = Math.max(1, server?.auto_backup_interval ?? 1);
	const [lastCrash, setLastCrash] = React.useState<CrashInfo | null>(null);

	const showError = React.useCallback(
		(error: unknown, fallback: string) => {
			const message = error instanceof Error ? error.message : fallback;
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
				const message = error instanceof Error ? error.message : 'Failed to resolve start command.';
				appendTerminalLine(`[system] ${message}`);
			}
		},
		[appendTerminalLine, serverDirectory],
	);

	const setOfflineState = React.useCallback(() => {
		setServerStatus(serverId, 'offline');
		runtimeRef.current.startAt = null;
		runtimeRef.current.manualStopRequested = false;
		runtimeRef.current.stopRequested = false;
		runtimeRef.current.restartRequested = false;
		runtimeRef.current.everRunning = false;
		updateServerStats(serverId, offlineServerStats());
	}, [serverId, setServerStatus, updateServerStats]);

	/** Like {@link setOfflineState} but parks the server in the `crashed` status
	 * and records the crash details for the crash panel. */
	const setCrashedState = React.useCallback(
		(crash: CrashInfo) => {
			setServerStatus(serverId, 'crashed');
			runtimeRef.current.startAt = null;
			runtimeRef.current.manualStopRequested = false;
			runtimeRef.current.stopRequested = false;
			runtimeRef.current.restartRequested = false;
			runtimeRef.current.everRunning = false;
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

	const resolveJava = React.useCallback(
		(excludeMajors: number[] = []) =>
			resolveServerJavaExecutable({
				provider: server?.provider,
				javaInstallation: server?.java_installation,
				globalDefault: user.java_installation_default,
				runtimes: javaRuntimes,
				excludeMajors,
			}),
		[javaRuntimes, server?.java_installation, server?.provider, user.java_installation_default],
	);

	// Resolves an installed compatible Java, or offers to download the
	// recommended one. Returns `null` when the user cancelled the download.
	const acquireJava = React.useCallback(async (): Promise<{
		executablePath: string;
		majorVersion: number | null;
	} | null> => {
		const resolution = resolveJava();
		if (resolution.status === 'resolved') {
			return { executablePath: resolution.executablePath, majorVersion: resolution.majorVersion };
		}
		const runtime = await ensureJava(resolution.requirement.recommendedMajor);
		return runtime ? { executablePath: runtime.executablePath, majorVersion: runtime.majorVersion } : null;
	}, [ensureJava, resolveJava]);

	// Resets the per-cycle bookkeeping for a fresh start (or restart) attempt.
	const beginStartCycle = React.useCallback((options?: { restart?: boolean }) => {
		const runtime = runtimeRef.current;
		runtime.manualStopRequested = false;
		runtime.restartRequested = Boolean(options?.restart);
		runtime.stopRequested = Boolean(options?.restart);
		runtime.forceKilled = false;
		runtime.everRunning = false;
		runtime.javaAttemptMajors = [];
		runtime.javaDidFallback = false;
		runtime.javaFallbackInProgress = false;
		runtime.javaDownloadAttempted = false;
		runtime.javaGiveUp = false;
		runtime.currentJavaExecutable = null;
	}, []);

	// Spawns the server with a specific Java executable and records the attempt so
	// the start-failure fallback can step down through versions.
	const startWithJava = React.useCallback(
		async (javaExecutable: string, majorVersion: number | null) => {
			if (!serverDirectory) return;
			runtimeRef.current.currentJavaExecutable = javaExecutable;
			if (majorVersion != null && !runtimeRef.current.javaAttemptMajors.includes(majorVersion)) {
				runtimeRef.current.javaAttemptMajors.push(majorVersion);
			}
			runtimeRef.current.awaitingReady = true;
			await appendResolvedStartCommand(javaExecutable);
			await invoke('start_server', { directory: serverDirectory, javaExecutable });
			runtimeRef.current.javaFallbackInProgress = false;
		},
		[appendResolvedStartCommand, serverDirectory],
	);

	// Reacts to a "wrong Java version" error during start: step down to the next
	// compatible installed runtime, or download/redirect when none is left.
	const handleJavaVersionError = React.useCallback(async () => {
		if (!serverDirectory) return;
		if (runtimeRef.current.manualStopRequested) return;
		if (runtimeRef.current.javaFallbackInProgress) return;
		if (!runtimeRef.current.awaitingReady) return;
		// Only automatic servers step down; a pinned override surfaces the error.
		if ((server?.java_installation ?? '').trim() !== '') return;

		runtimeRef.current.javaFallbackInProgress = true;
		runtimeRef.current.awaitingReady = false;

		// The crashing JVM is exiting anyway — make sure it's gone before retrying.
		try {
			await invoke('force_kill_server', { directory: serverDirectory });
		} catch {}

		const plan = planJavaFallback({
			provider: server?.provider,
			globalDefault: user.java_installation_default,
			runtimes: javaRuntimes,
			attemptedMajors: runtimeRef.current.javaAttemptMajors,
		});

		if (plan.kind === 'retry') {
			runtimeRef.current.javaDidFallback = true;
			appendTerminalLine(`[system] That Java version was too old. Trying Java ${plan.majorVersion}...`);
			try {
				await startWithJava(plan.executablePath, plan.majorVersion);
			} catch (err) {
				runtimeRef.current.javaFallbackInProgress = false;
				setOfflineState();
				appendTerminalLine(
					`[system] ${err instanceof Error ? err.message : 'Failed to start with fallback Java.'}`,
				);
			}
			return;
		}

		// No installed Java worked — offer to download the recommended one (once).
		if (!runtimeRef.current.javaDownloadAttempted) {
			runtimeRef.current.javaDownloadAttempted = true;
			const requiredMajor = plan.requirement.recommendedMajor;
			appendTerminalLine(`[system] No installed Java worked. Trying to get Java ${requiredMajor}...`);
			const runtime = await ensureJava(requiredMajor);
			if (runtime) {
				runtimeRef.current.javaDidFallback = true;
				try {
					await startWithJava(runtime.executablePath, runtime.majorVersion);
					return;
				} catch {}
			}
		}

		runtimeRef.current.javaFallbackInProgress = false;
		runtimeRef.current.javaGiveUp = true;
		setOfflineState();
		const message = `No compatible Java runtime could start this server (needs Java ${plan.requirement.recommendedMajor}).`;
		setErrorMessage(message);
		appendTerminalLine(`[system] ${message}`);
		toast.error(message);
	}, [
		appendTerminalLine,
		ensureJava,
		javaRuntimes,
		server?.java_installation,
		server?.provider,
		serverDirectory,
		setErrorMessage,
		setOfflineState,
		startWithJava,
		user.java_installation_default,
	]);

	const syncServerContents = React.useCallback(async () => {
		if (!serverDirectory) return;
		if (!serverId) return;

		try {
			const result = await invoke<ScanServerContentsResult>('scan_server_contents', {
				directory: serverDirectory,
			});
			updateServer(serverId, {
				plugins: result.plugins,
				mods: result.mods,
				worlds: result.worlds,
				datapacks: result.datapacks,
				backups: mapScannedBackups(result.backups),
				stats: {
					worlds_size_bytes: Math.max(0, Number(result.worldsSizeBytes) || 0),
					backups_size_bytes: Math.max(0, Number(result.backupsSizeBytes) || 0),
				},
			});
		} catch {}
	}, [serverDirectory, serverId, updateServer]);

	const createAutomaticBackup = React.useCallback(
		async (reason: BackupReason) => {
			if (!serverDirectory) return;
			// Proxy servers (e.g. Velocity) have no world data to back up, so
			// auto-backups always fail. Skip them entirely instead of surfacing a
			// recurring "Auto backup failed" message.
			if (isProxyProvider(server?.provider)) return;
			if (runtimeRef.current.isCreatingAutoBackup) return;

			runtimeRef.current.isCreatingAutoBackup = true;
			try {
				const result = await invoke<CreateServerBackupResult>('create_server_backup', {
					directory: serverDirectory,
					name: null,
					reason,
				});
				const deletedBackupsCount = Math.max(0, Number(result.deletedBackupsCount) || 0);
				if (deletedBackupsCount > 0) {
					toast.info(
						deletedBackupsCount === 1
							? 'Removed 1 old backup per your retention settings.'
							: `Removed ${deletedBackupsCount} old backups per your retention settings.`,
					);
				}
				if (reason !== 'interval') {
					appendTerminalLine(`[system] Auto backup created (${reason.replace('_', ' ')})`);
				}
				await syncServerContents();
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to create automatic backup.';
				if (message.startsWith(BACKUP_STORAGE_LIMIT_ERROR_PREFIX)) {
					toast.error(message, { duration: Infinity, id: 'backup-storage-limit' });
				}
				appendTerminalLine(`[system] Auto backup failed: ${message}`);
			} finally {
				runtimeRef.current.isCreatingAutoBackup = false;
			}
		},
		[appendTerminalLine, server?.provider, serverDirectory, syncServerContents],
	);

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
	// externally-running server).
	React.useEffect(() => {
		if (!serverDirectory || !serverId) return;
		let active = true;
		void (async () => {
			try {
				const snapshot = await invoke<ServerRuntimeSnapshot>('get_server_runtime', {
					directory: serverDirectory,
				});
				if (!active) return;
				setServerStatus(serverId, mapRuntimeStateToStatus(snapshot.state));
				if (snapshot.serverPort != null && snapshot.serverPort !== serverTelemetryPort) {
					updateServer(serverId, { telemetry_port: snapshot.serverPort });
				}
				if (snapshot.state === 'online' || snapshot.state === 'running-external') {
					runtimeRef.current.everRunning = true;
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
	}, [serverDirectory, serverId, serverTelemetryPort, setServerStatus, updateServer, updateServerStats]);

	// Console output: terminal display + early wrong-Java detection.
	React.useEffect(() => {
		if (!serverDirectory) return;
		if (!serverId) return;

		let unlisten: UnlistenFn | null = null;
		let active = true;

		listen<ServerOutputEvent>('server-output', (event) => {
			if (!active) return;
			if (event.payload.directory !== serverDirectory) return;
			const stream = event.payload.stream;
			if (stream !== 'stdout' && stream !== 'stderr') return;

			const cleaned = stripAnsi(event.payload.line);
			const dedupeKey = `${stream}:${cleaned}`;
			const now = Date.now();
			if (runtimeRef.current.lastOutputKey === dedupeKey && now - runtimeRef.current.lastOutputAt < 250) {
				return;
			}

			runtimeRef.current.lastOutputKey = dedupeKey;
			runtimeRef.current.lastOutputAt = now;

			if (isJavaVersionError(cleaned)) {
				void handleJavaVersionError();
			}

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
	}, [appendTerminalLine, handleJavaVersionError, serverDirectory, serverId]);

	// Authoritative lifecycle state from the backend supervisor.
	React.useEffect(() => {
		if (!serverDirectory || !serverId) return;

		let unlisten: UnlistenFn | null = null;
		let active = true;

		listen<ServerRuntimeStateEvent>('server-runtime-state', (event) => {
			if (!active) return;
			if (event.payload.directory !== serverDirectory) return;
			const { state, exitCode, startedAt, serverPort, stderrTail } = event.payload;

			// The supervisor knows the port the server is actually bound to (it may
			// have been reassigned on start when the configured one was taken).
			if (serverPort != null && serverPort !== serverTelemetryPort) {
				updateServer(serverId, { telemetry_port: serverPort });
			}

			if (state === 'online' || state === 'running-external') {
				runtimeRef.current.everRunning = true;
				runtimeRef.current.awaitingReady = false;
				runtimeRef.current.javaFallbackInProgress = false;
				runtimeRef.current.javaAttemptMajors = [];
				runtimeRef.current.isAutoRestarting = false;
				setLastCrash(null);
				runtimeRef.current.stopRequested = false;
				runtimeRef.current.restartRequested = false;
				runtimeRef.current.manualStopRequested = false;
				runtimeRef.current.forceKilled = false;
				if (!runtimeRef.current.startAt) {
					runtimeRef.current.startAt = startedAt ? new Date(startedAt) : new Date();
				}
				setServerStatus(serverId, 'online');
				updateServerStats(serverId, { online: true, uptime: runtimeRef.current.startAt });

				// The current Java worked. If we stepped down to find it, pin it.
				if (
					runtimeRef.current.javaDidFallback &&
					runtimeRef.current.currentJavaExecutable &&
					(server?.java_installation ?? '').trim() === ''
				) {
					const pinned = runtimeRef.current.currentJavaExecutable;
					runtimeRef.current.javaDidFallback = false;
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
				// Treat it like a graceful close (run the on-close backup) but land in
				// the sleeping status rather than offline.
				void (async () => {
					const closeBackupKey = makeCloseBackupKey(serverId, exitCode);
					if (
						!runtimeRef.current.forceKilled &&
						hasOnCloseBackup &&
						runtimeRef.current.lastOnCloseBackupKey !== closeBackupKey
					) {
						runtimeRef.current.lastOnCloseBackupKey = closeBackupKey;
						await createAutomaticBackup('on_close');
					}
					runtimeRef.current.startAt = null;
					runtimeRef.current.stopRequested = false;
					setServerStatus(serverId, 'sleeping');
					updateServerStats(serverId, offlineServerStats());
				})();
				return;
			}

			// offline or crashed. (Backend auto-restart — including crash-loop
			// guarding — lives in the Rust supervisor now, so it keeps working with
			// the app window closed. The frontend only reflects the resulting state
			// and, for boot-time Java errors, still owns the version step-down.)
			void (async () => {
				const closeBackupKey = makeCloseBackupKey(serverId, exitCode);

				if (
					!runtimeRef.current.forceKilled &&
					hasOnCloseBackup &&
					runtimeRef.current.lastOnCloseBackupKey !== closeBackupKey
				) {
					runtimeRef.current.lastOnCloseBackupKey = closeBackupKey;
					await createAutomaticBackup('on_close');
				}

				// The version-error fallback owns the restart while it's stepping down.
				if (runtimeRef.current.javaFallbackInProgress) {
					return;
				}

				runtimeRef.current.forceKilled = false;

				if (state === 'crashed') {
					appendTerminalLine(
						exitCode != null
							? `[system] Server crashed (exit code ${exitCode}).`
							: '[system] Server crashed.',
					);
					setCrashedState({ exitCode, stderrTail: stderrTail ?? [], at: new Date() });
					return;
				}

				setOfflineState();
			})();
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
		createAutomaticBackup,
		hasOnCloseBackup,
		server?.java_installation,
		serverDirectory,
		serverId,
		serverTelemetryPort,
		setCrashedState,
		setOfflineState,
		setServerStatus,
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

	React.useEffect(() => {
		if (!serverStatus) return;
		const becameOnline = runtimeRef.current.previousStatus !== 'online' && serverStatus === 'online';

		if (becameOnline && hasOnStartBackup) {
			void createAutomaticBackup('on_start');
		}

		runtimeRef.current.previousStatus = serverStatus;
	}, [createAutomaticBackup, hasOnStartBackup, serverStatus]);

	React.useEffect(() => {
		if (!serverStatus) return;
		if (serverStatus !== 'online') return;
		if (!hasIntervalBackup) return;

		const timer = window.setInterval(() => {
			void createAutomaticBackup('interval');
		}, autoBackupIntervalMinutes * 60_000);

		return () => {
			window.clearInterval(timer);
		};
	}, [autoBackupIntervalMinutes, createAutomaticBackup, hasIntervalBackup, serverStatus]);

	const handleItemsChanged = React.useCallback(async () => {
		await syncServerContents();
	}, [syncServerContents]);

	const handleStart = React.useCallback(async () => {
		if (!serverDirectory) return;
		if (isBusy) return;

		beginStartCycle();
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

			await startWithJava(java.executablePath, java.majorVersion);
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
		beginStartCycle,
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

		runtimeRef.current.manualStopRequested = true;
		runtimeRef.current.stopRequested = true;
		runtimeRef.current.forceKilled = false;
		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		appendTerminalLine('[system] Stopping server...');

		// The supervisor detects the actual exit and emits `offline`, which drives
		// the on-close backup and final offline state.
		try {
			await invoke('stop_server', { directory: serverDirectory });
		} catch (err) {
			setOfflineState();
			const message = err instanceof Error ? err.message : 'Failed to stop server.';
			appendTerminalLine(`[system] ${message}`);
		} finally {
			setIsBusy(false);
		}
	}, [appendTerminalLine, isBusy, serverDirectory, serverId, setIsBusy, setOfflineState, setServerStatus]);

	const handleSleep = React.useCallback(async () => {
		if (!serverDirectory) return;
		if (isBusy) return;

		runtimeRef.current.manualStopRequested = true;
		runtimeRef.current.stopRequested = true;
		runtimeRef.current.forceKilled = false;
		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		appendTerminalLine('[system] Putting server to sleep...');

		try {
			await invoke('sleep_server', { directory: serverDirectory });
			// Leave the status `closing`; the `server-runtime-state` event (sleeping,
			// or offline if sleep mode failed to start) corrects it once the process
			// actually exits.
		} catch (err) {
			// The backend rejected the request before touching the process — it's
			// still online, so revert status and the bookkeeping flags set above
			// rather than leaving them stuck (mirrors setOfflineState's cleanup).
			runtimeRef.current.manualStopRequested = false;
			runtimeRef.current.stopRequested = false;
			runtimeRef.current.forceKilled = false;
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

		beginStartCycle({ restart: true });
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

			runtimeRef.current.currentJavaExecutable = java.executablePath;
			if (java.majorVersion != null && !runtimeRef.current.javaAttemptMajors.includes(java.majorVersion)) {
				runtimeRef.current.javaAttemptMajors.push(java.majorVersion);
			}
			runtimeRef.current.awaitingReady = true;
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
		beginStartCycle,
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

		runtimeRef.current.manualStopRequested = true;
		runtimeRef.current.stopRequested = true;
		runtimeRef.current.restartRequested = false;
		runtimeRef.current.forceKilled = true;
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

			if (isStopCommand(command)) {
				runtimeRef.current.manualStopRequested = true;
				runtimeRef.current.stopRequested = true;
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
		handleItemsChanged,
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
