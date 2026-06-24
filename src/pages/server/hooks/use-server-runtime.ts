import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import type { Server, ServerStatus, ServerUpdate } from '@/data/servers';
import type { TelemetryKey } from '@/lib/mserve-schema';
import { isJavaVersionError, isServerReadyLine, parseTps, stripAnsi } from '@/lib/utils';
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';
import { mapTelemetryToStats } from '@/lib/server-telemetry';
import { useUser } from '@/data/user';
import { useJavaRuntimes } from '@/data/java-runtimes';
import { useJavaDownload } from '@/data/java-download';
import { planJavaFallback, resolveServerJavaExecutable } from '@/lib/java-resolution';
import { setServerJavaInstallation } from '@/lib/java-runtime-service';
import {
	type CreateServerBackupResult,
	type RuntimeStatusResult,
	type ScanServerContentsResult,
	type ServerOutputEvent,
	type ServerTelemetryResult,
} from '../server-types';
import { didRequestStop, isStopCommand, makeCloseBackupKey, mapScannedBackups } from '../server-utils';
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
const TELEMETRY_POLL_INTERVAL_MS = 5000;

type RuntimeState = {
	startAt: Date | null;
	lastOutputKey: string;
	lastOutputAt: number;
	stopRequested: boolean;
	restartRequested: boolean;
	lastOnCloseBackupKey: string;
	isAutoRestarting: boolean;
	manualStopRequested: boolean;
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
	lastOnCloseBackupKey: '',
	isAutoRestarting: false,
	manualStopRequested: false,
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
	const telemetryInFlightRef = React.useRef(false);
	const serverDirectory = server?.directory;
	const serverStatus = server?.status;
	const providerCapabilities = React.useMemo(
		() => getServerProviderCapabilities(server?.provider),
		[server?.provider],
	);
	const supportedTelemetry = React.useMemo(
		() => server?.provider?.supported_telemetry ?? [],
		[server?.provider?.supported_telemetry],
	);
	const supportsTelemetry = React.useCallback(
		(key: TelemetryKey) => supportedTelemetry.includes(key),
		[supportedTelemetry],
	);

	const autoBackupModes = server?.auto_backup ?? [];
	const hasOnStartBackup = autoBackupModes.includes('on_start');
	const hasOnCloseBackup = autoBackupModes.includes('on_close');
	const hasIntervalBackup = autoBackupModes.includes('interval');
	const autoBackupIntervalMinutes = Math.max(1, server?.auto_backup_interval ?? 1);
	const isAutoRestartEnabled = Boolean(server?.auto_restart);

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
		updateServerStats(serverId, {
			online: false,
			players_online: null,
			players_max: null,
			server_version: null,
			tps: null,
			ram_used: null,
			cpu_used: null,
			uptime: null,
		});
	}, [serverId, setServerStatus, updateServerStats]);

	const setStartingState = React.useCallback(() => {
		runtimeRef.current.startAt = new Date();
		updateServerStats(serverId, {
			online: false,
			players_online: null,
			players_max: null,
			tps: null,
			ram_used: null,
			cpu_used: null,
			uptime: runtimeRef.current.startAt,
		});
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

	const syncTelemetry = React.useCallback(async () => {
		if (!serverDirectory || !server) return;
		if (telemetryInFlightRef.current) return;
		telemetryInFlightRef.current = true;

		try {
			const telemetry = await invoke<ServerTelemetryResult>('get_server_telemetry', {
				directory: serverDirectory,
			});

			updateServerStats(
				serverId,
				mapTelemetryToStats(server, telemetry, { fallbackUptime: runtimeRef.current.startAt }),
			);

			if (supportsTelemetry('online') && telemetry.online && serverStatus === 'starting') {
				setServerStatus(serverId, 'online');
				// Online via ping (no ready line needed) — stop watching for a startup
				// Java-version error so later log noise can't trigger a false step-down.
				runtimeRef.current.awaitingReady = false;
			}
		} catch {
			if (!supportsTelemetry('online')) return;
			updateServerStats(serverId, {
				online: false,
				players_online: null,
				players_max: null,
				server_version: null,
			});
		} finally {
			telemetryInFlightRef.current = false;
		}
	}, [server, serverDirectory, serverId, serverStatus, supportsTelemetry, setServerStatus, updateServerStats]);

	const syncServerContents = React.useCallback(async () => {
		if (!serverDirectory) return;
		if (!serverId) return;

		try {
			const result = await invoke<ScanServerContentsResult>('scan_server_contents', {
				directory: serverDirectory,
			});
			updateServer(serverId, {
				plugins: result.plugins,
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
				});
				const deletedBackupsCount = Math.max(0, Number(result.deletedBackupsCount) || 0);
				if (deletedBackupsCount > 0) {
					toast.info(
						deletedBackupsCount === 1
							? 'Deleted 1 old backup to make space for the new backup.'
							: `Deleted ${deletedBackupsCount} old backups to make space for the new backup.`,
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

			if (stream === 'stdout') {
				if (isServerReadyLine(cleaned, providerCapabilities.kind)) {
					setServerStatus(serverId, 'online');
					if (!runtimeRef.current.startAt) {
						runtimeRef.current.startAt = new Date();
					}
					updateServerStats(serverId, {
						online: true,
						uptime: runtimeRef.current.startAt,
					});

					// The current Java worked. Clear the start-cycle fallback state and,
					// if we had to step down to find it, pin it so later starts skip the
					// trial-and-error.
					runtimeRef.current.awaitingReady = false;
					runtimeRef.current.javaFallbackInProgress = false;
					runtimeRef.current.javaAttemptMajors = [];
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
				}

				if (providerCapabilities.supportsTpsCommand && supportsTelemetry('tps')) {
					const tpsInfo = parseTps(cleaned);
					if (tpsInfo) {
						updateServerStats(serverId, { tps: tpsInfo.tps });
					}
				}
			}

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
	}, [
		appendTerminalLine,
		handleJavaVersionError,
		providerCapabilities.kind,
		server?.java_installation,
		supportsTelemetry,
		serverDirectory,
		serverId,
		setServerStatus,
		updateServer,
		updateServerStats,
	]);

	React.useEffect(() => {
		if (!serverDirectory) return;
		if (!serverId) return;
		if (serverStatus !== 'online') return;

		void syncTelemetry();
		const timer = window.setInterval(() => {
			void syncTelemetry();
		}, TELEMETRY_POLL_INTERVAL_MS);

		return () => {
			window.clearInterval(timer);
		};
	}, [serverDirectory, serverId, serverStatus, syncTelemetry]);

	React.useEffect(() => {
		if (!serverDirectory) return;
		if (!serverId) return;
		if (serverStatus === 'offline') return;

		const timer = window.setInterval(async () => {
			try {
				const runtime = await invoke<RuntimeStatusResult>('get_server_runtime_status', {
					directory: serverDirectory,
				});

				if (runtime.running) {
					return;
				}

				const stopWasRequested = didRequestStop(
					runtimeRef.current.stopRequested,
					runtimeRef.current.restartRequested,
					runtimeRef.current.manualStopRequested,
				);
				const closeBackupKey = makeCloseBackupKey(serverId, runtime.exitCode);

				if (
					!stopWasRequested &&
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

				if (
					!stopWasRequested &&
					isAutoRestartEnabled &&
					!runtimeRef.current.isAutoRestarting &&
					!runtimeRef.current.javaGiveUp
				) {
					runtimeRef.current.isAutoRestarting = true;
					setStartingState();
					appendTerminalLine('[system] Server closed. Auto restart is enabled, starting again...');

					try {
						const resolution = resolveJava();
						if (resolution.status !== 'resolved') {
							throw new Error('No Java runtime available to auto-restart.');
						}
						await startWithJava(resolution.executablePath, resolution.majorVersion);
						await syncServerContents();
						runtimeRef.current.isAutoRestarting = false;
						return;
					} catch {
						runtimeRef.current.isAutoRestarting = false;
					}
				}

				setOfflineState();
			} catch {}
		}, 2000);

		return () => {
			window.clearInterval(timer);
		};
	}, [
		appendTerminalLine,
		createAutomaticBackup,
		hasOnCloseBackup,
		isAutoRestartEnabled,
		resolveJava,
		serverDirectory,
		serverStatus,
		serverId,
		setOfflineState,
		setStartingState,
		startWithJava,
		syncServerContents,
	]);

	React.useEffect(() => {
		if (!serverDirectory) return;
		if (serverStatus !== 'online') return;

		void (async () => {
			try {
				if (providerCapabilities.supportsTpsCommand && supportsTelemetry('tps')) {
					await invoke('send_server_command', {
						directory: serverDirectory,
						command: 'tps',
					});
				}
			} catch {}
		})();

		const timer = window.setInterval(async () => {
			try {
				if (providerCapabilities.supportsTpsCommand && supportsTelemetry('tps')) {
					await invoke('send_server_command', {
						directory: serverDirectory,
						command: 'tps',
					});
				}
			} catch {}
		}, 15000);

		return () => {
			window.clearInterval(timer);
		};
	}, [providerCapabilities.supportsTpsCommand, serverDirectory, serverStatus, supportsTelemetry]);

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

		runtimeRef.current.manualStopRequested = false;
		runtimeRef.current.stopRequested = false;
		runtimeRef.current.restartRequested = false;
		// Reset automatic-Java fallback state for a fresh start cycle.
		runtimeRef.current.javaAttemptMajors = [];
		runtimeRef.current.javaDidFallback = false;
		runtimeRef.current.javaFallbackInProgress = false;
		runtimeRef.current.javaDownloadAttempted = false;
		runtimeRef.current.javaGiveUp = false;
		runtimeRef.current.currentJavaExecutable = null;
		setIsBusy(true);
		setStartingState();
		appendTerminalLine('[system] Starting server...');

		try {
			const resolution = resolveJava();
			let javaExecutable: string;
			let major: number | null;
			if (resolution.status === 'resolved') {
				javaExecutable = resolution.executablePath;
				major = resolution.majorVersion;
			} else {
				const runtime = await ensureJava(resolution.requirement.recommendedMajor);
				if (!runtime) {
					setOfflineState();
					appendTerminalLine('[system] Start cancelled — no Java runtime available.');
					return;
				}
				javaExecutable = runtime.executablePath;
				major = runtime.majorVersion;
			}

			await startWithJava(javaExecutable, major);
			await syncServerContents();
		} catch (err) {
			setOfflineState();
			const message = showError(err, 'Failed to start server.');
			appendTerminalLine(`[system] ${message}`);
		} finally {
			setIsBusy(false);
		}
	}, [
		appendTerminalLine,
		ensureJava,
		isBusy,
		resolveJava,
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
		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		appendTerminalLine('[system] Stopping server...');

		try {
			await invoke('stop_server', { directory: serverDirectory });
			if (hasOnCloseBackup) {
				await createAutomaticBackup('on_close');
				runtimeRef.current.lastOnCloseBackupKey = `${serverId}:${Date.now()}`;
			}
			setOfflineState();
			await syncServerContents();
		} catch (err) {
			setOfflineState();
			const message = err instanceof Error ? err.message : 'Failed to stop server.';
			appendTerminalLine(`[system] ${message}`);
		} finally {
			runtimeRef.current.stopRequested = false;
			setIsBusy(false);
		}
	}, [
		appendTerminalLine,
		createAutomaticBackup,
		hasOnCloseBackup,
		isBusy,
		serverDirectory,
		serverId,
		setIsBusy,
		setOfflineState,
		setServerStatus,
		syncServerContents,
	]);

	const handleRestart = React.useCallback(async () => {
		if (!serverDirectory) return;
		if (isBusy) return;

		runtimeRef.current.manualStopRequested = false;
		runtimeRef.current.restartRequested = true;
		runtimeRef.current.stopRequested = true;
		// Reset automatic-Java fallback state for a fresh start cycle.
		runtimeRef.current.javaAttemptMajors = [];
		runtimeRef.current.javaDidFallback = false;
		runtimeRef.current.javaFallbackInProgress = false;
		runtimeRef.current.javaDownloadAttempted = false;
		runtimeRef.current.javaGiveUp = false;
		runtimeRef.current.currentJavaExecutable = null;
		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		appendTerminalLine('[system] Restarting server...');

		try {
			await invoke('stop_server', { directory: serverDirectory });
			if (hasOnCloseBackup) {
				await createAutomaticBackup('on_close');
				runtimeRef.current.lastOnCloseBackupKey = `${serverId}:${Date.now()}`;
			}
		} catch {}

		setStartingState();

		try {
			const resolution = resolveJava();
			let javaExecutable: string;
			let major: number | null;
			if (resolution.status === 'resolved') {
				javaExecutable = resolution.executablePath;
				major = resolution.majorVersion;
			} else {
				const runtime = await ensureJava(resolution.requirement.recommendedMajor);
				if (!runtime) {
					setOfflineState();
					appendTerminalLine('[system] Restart cancelled — no Java runtime available.');
					return;
				}
				javaExecutable = runtime.executablePath;
				major = runtime.majorVersion;
			}

			await startWithJava(javaExecutable, major);
			await syncServerContents();
		} catch (err) {
			setOfflineState();
			const message = showError(err, 'Failed to restart server.');
			appendTerminalLine(`[system] ${message}`);
		} finally {
			runtimeRef.current.restartRequested = false;
			runtimeRef.current.stopRequested = false;
			setIsBusy(false);
		}
	}, [
		appendTerminalLine,
		createAutomaticBackup,
		ensureJava,
		hasOnCloseBackup,
		isBusy,
		resolveJava,
		serverDirectory,
		serverId,
		setIsBusy,
		setOfflineState,
		setServerStatus,
		setStartingState,
		showError,
		startWithJava,
		syncServerContents,
	]);

	const handleForceKill = React.useCallback(async () => {
		if (!serverDirectory) return;
		if (isBusy) return;

		runtimeRef.current.manualStopRequested = true;
		runtimeRef.current.stopRequested = true;
		runtimeRef.current.restartRequested = false;
		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		appendTerminalLine('[system] Force killing server process...');

		try {
			const message = await invoke<string>('force_kill_server', { directory: serverDirectory });
			appendTerminalLine(`[system] ${message}`);
			setOfflineState();
			await syncServerContents();
		} catch (err) {
			setOfflineState();
			const message = showError(err, 'Failed to force kill server process.');
			appendTerminalLine(`[system] ${message}`);
		} finally {
			runtimeRef.current.stopRequested = false;
			setIsBusy(false);
		}
	}, [
		appendTerminalLine,
		isBusy,
		serverDirectory,
		serverId,
		setIsBusy,
		setOfflineState,
		setServerStatus,
		showError,
		syncServerContents,
	]);

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
		handleRestart,
		handleForceKill,
		handleTerminalCommandSubmit,
	};
};
