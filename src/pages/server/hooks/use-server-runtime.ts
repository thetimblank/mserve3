import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import type { Server, ServerStatus, ServerUpdate } from '@/data/servers';
import type { TelemetryKey } from '@/lib/mserve-schema';
import { isServerReadyLine, parseTps, stripAnsi } from '@/lib/utils';
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';
import { useUser } from '@/data/user';
import {
	type CreateServerBackupResult,
	type RuntimeStatusResult,
	type ScanServerContentsResult,
	type ServerOutputEvent,
	type ServerTelemetryResult,
} from '../server-types';
import { didRequestStop, isStopCommand, makeCloseBackupKey, mapScannedBackups } from '../server-utils';

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

	const appendResolvedStartCommand = React.useCallback(async () => {
		if (!serverDirectory) return;

		try {
			const command = await invoke<string>('get_server_start_command', {
				directory: serverDirectory,
				globalJavaInstallation: user.java_installation_default,
			});
			appendTerminalLine(`[system] Running: ${command}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to resolve start command.';
			appendTerminalLine(`[system] ${message}`);
		}
	}, [appendTerminalLine, serverDirectory, user.java_installation_default]);

	const toUptimeDate = React.useCallback((value: string | null): Date | null => {
		if (!value) return null;
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}, []);

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

	const syncTelemetry = React.useCallback(async () => {
		if (!serverDirectory) return;
		if (telemetryInFlightRef.current) return;
		telemetryInFlightRef.current = true;

		try {
			const telemetry = await invoke<ServerTelemetryResult>('get_server_telemetry', {
				directory: serverDirectory,
			});

			const pingAvailable = supportsTelemetry('online') && telemetry.online;
			const uptime = toUptimeDate(telemetry.uptime) ?? runtimeRef.current.startAt;

			const nextStats: Partial<Server['stats']> = {
				uptime,
				players_online: supportsTelemetry('list') && pingAvailable ? telemetry.playersOnline : null,
				players_max: supportsTelemetry('list') && pingAvailable ? telemetry.playersMax : null,
				server_version: supportsTelemetry('version') && pingAvailable ? telemetry.serverVersion : null,
				provider_version: supportsTelemetry('provider') ? telemetry.providerVersion : null,
				ram_used: supportsTelemetry('ram') ? telemetry.ramUsed : null,
				cpu_used: supportsTelemetry('cpu') ? telemetry.cpuUsed : null,
			};

			if (supportsTelemetry('online')) {
				nextStats.online = telemetry.online;
				if (!telemetry.online) {
					nextStats.players_online = null;
					nextStats.players_max = null;
					nextStats.server_version = null;
				}
			}

			if (!providerCapabilities.supportsTpsCommand || !supportsTelemetry('tps')) {
				nextStats.tps = null;
			}

			updateServerStats(serverId, nextStats);

			if (supportsTelemetry('online') && telemetry.online && serverStatus === 'starting') {
				setServerStatus(serverId, 'online');
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
	}, [
		providerCapabilities.supportsTpsCommand,
		supportsTelemetry,
		serverDirectory,
		serverId,
		serverStatus,
		setServerStatus,
		toUptimeDate,
		updateServerStats,
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
		[appendTerminalLine, serverDirectory, syncServerContents],
	);

	React.useEffect(() => {
		setErrorMessage(null);
		runtimeRef.current = initialRuntimeState();
	}, [serverId, setErrorMessage]);

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
				}

				if (providerCapabilities.supportsTpsCommand && supportsTelemetry('tps')) {
					const tpsInfo = parseTps(cleaned);
					if (tpsInfo) {
						updateServerStats(serverId, { tps: tpsInfo.tps });
					}
				}
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
		providerCapabilities.kind,
		supportsTelemetry,
		serverDirectory,
		serverId,
		setServerStatus,
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

				if (!stopWasRequested && isAutoRestartEnabled && !runtimeRef.current.isAutoRestarting) {
					runtimeRef.current.isAutoRestarting = true;
					setStartingState();
					appendTerminalLine('[system] Server closed. Auto restart is enabled, starting again...');

					try {
						await appendResolvedStartCommand();
						await invoke('start_server', {
							directory: serverDirectory,
							globalJavaInstallation: user.java_installation_default,
						});
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
		appendResolvedStartCommand,
		appendTerminalLine,
		createAutomaticBackup,
		hasOnCloseBackup,
		isAutoRestartEnabled,
		serverDirectory,
		serverStatus,
		serverId,
		setOfflineState,
		setStartingState,
		syncServerContents,
		user.java_installation_default,
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
		setIsBusy(true);
		setStartingState();
		appendTerminalLine('[system] Starting server...');

		try {
			await appendResolvedStartCommand();
			await invoke('start_server', {
				directory: serverDirectory,
				globalJavaInstallation: user.java_installation_default,
			});
			await syncServerContents();
		} catch (err) {
			setOfflineState();
			const message = showError(err, 'Failed to start server.');
			appendTerminalLine(`[system] ${message}`);
		} finally {
			setIsBusy(false);
		}
	}, [
		appendResolvedStartCommand,
		appendTerminalLine,
		isBusy,
		serverDirectory,
		setIsBusy,
		setOfflineState,
		setStartingState,
		showError,
		syncServerContents,
		user.java_installation_default,
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
			await appendResolvedStartCommand();
			await invoke('start_server', {
				directory: serverDirectory,
				globalJavaInstallation: user.java_installation_default,
			});
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
		appendResolvedStartCommand,
		appendTerminalLine,
		createAutomaticBackup,
		hasOnCloseBackup,
		isBusy,
		serverDirectory,
		serverId,
		setIsBusy,
		setOfflineState,
		setServerStatus,
		setStartingState,
		showError,
		syncServerContents,
		user.java_installation_default,
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
