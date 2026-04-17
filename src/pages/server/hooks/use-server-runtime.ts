import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import type { Server, ServerStatus, ServerUpdate } from '@/data/servers';
import {
	isServerReadyLine,
	parseListPlayers,
	parseTps,
	parseVersion,
	shouldHideBackgroundLine,
	stripAnsi,
} from '@/lib/utils';
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';
import { useUser } from '@/data/user';
import {
	type RuntimeStatusResult,
	type ScanServerContentsResult,
	type ServerOutputEvent,
} from '../server-types';
import { didRequestStop, isStopCommand, makeCloseBackupKey, mapScannedBackups } from '../server-utils';

type Args = {
	server: Server | undefined;
	serverId: string;
	isBusy: boolean;
	setIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
	hideBackgroundTelemetry: boolean;
	terminalInput: string;
	setTerminalInput: React.Dispatch<React.SetStateAction<string>>;
	setErrorMessage: React.Dispatch<React.SetStateAction<string | null>>;
	setServerStatus: (id: string, status: ServerStatus) => void;
	updateServer: (id: string, update: ServerUpdate) => void;
	updateServerStats: (id: string, stats: Partial<Server['stats']>) => void;
	appendTerminalLine: (line: string) => void;
	clearTerminalSession: () => void;
};

type BackupReason = 'on_start' | 'on_close' | 'interval';

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
	hideBackgroundTelemetry,
	terminalInput,
	setTerminalInput,
	setErrorMessage,
	setServerStatus,
	updateServer,
	updateServerStats,
	appendTerminalLine,
	clearTerminalSession,
}: Args) => {
	const { user } = useUser();
	const runtimeRef = React.useRef<RuntimeState>(initialRuntimeState());
	const serverDirectory = server?.directory;
	const serverStatus = server?.status;
	const providerCapabilities = React.useMemo(
		() => getServerProviderCapabilities(server?.provider),
		[server?.provider],
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

	const setOfflineState = React.useCallback(() => {
		setServerStatus(serverId, 'offline');
		clearTerminalSession();
		runtimeRef.current.startAt = null;
		runtimeRef.current.manualStopRequested = false;
		updateServerStats(serverId, { players: 0, tps: 0, uptime: null });
	}, [clearTerminalSession, serverId, setServerStatus, updateServerStats]);

	const setStartingState = React.useCallback(() => {
		runtimeRef.current.startAt = new Date();
		updateServerStats(serverId, {
			players: 0,
			tps: 0,
			uptime: runtimeRef.current.startAt,
		});
		setServerStatus(serverId, 'starting');
	}, [serverId, setServerStatus, updateServerStats]);

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
			});
		} catch {}
	}, [serverDirectory, serverId, updateServer]);

	const createAutomaticBackup = React.useCallback(
		async (reason: BackupReason) => {
			if (!serverDirectory) return;
			if (runtimeRef.current.isCreatingAutoBackup) return;

			runtimeRef.current.isCreatingAutoBackup = true;
			try {
				await invoke('create_server_backup', { directory: serverDirectory });
				if (reason !== 'interval') {
					appendTerminalLine(`[system] Auto backup created (${reason.replace('_', ' ')})`);
				}
				await syncServerContents();
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to create automatic backup.';
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
			if (event.payload.stream !== 'stdout') return;

			const cleaned = stripAnsi(event.payload.line);
			const dedupeKey = `${event.payload.stream}:${cleaned}`;
			const now = Date.now();
			if (runtimeRef.current.lastOutputKey === dedupeKey && now - runtimeRef.current.lastOutputAt < 250) {
				return;
			}

			runtimeRef.current.lastOutputKey = dedupeKey;
			runtimeRef.current.lastOutputAt = now;

			if (isServerReadyLine(cleaned, providerCapabilities.kind)) {
				setServerStatus(serverId, 'online');
				if (!runtimeRef.current.startAt) {
					runtimeRef.current.startAt = new Date();
				}
				updateServerStats(serverId, { uptime: runtimeRef.current.startAt });
			}

			const listInfo = parseListPlayers(cleaned);
			if (listInfo) {
				updateServerStats(serverId, {
					players: listInfo.players,
					capacity: listInfo.capacity,
				});
			}

			const tpsInfo = parseTps(cleaned);
			if (tpsInfo) {
				updateServerStats(serverId, { tps: tpsInfo.tps });
			}

			const versionInfo = parseVersion(cleaned, providerCapabilities.kind);
			if (versionInfo) {
				updateServer(serverId, { version: versionInfo });
			}

			if (hideBackgroundTelemetry && shouldHideBackgroundLine(cleaned)) {
				return;
			}

			appendTerminalLine(`[stdout] ${cleaned}`);
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
		hideBackgroundTelemetry,
		providerCapabilities.kind,
		serverDirectory,
		serverId,
		setServerStatus,
		updateServer,
		updateServerStats,
	]);

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
				await invoke('send_server_command', {
					directory: serverDirectory,
					command: 'list',
				});
				if (providerCapabilities.supportsTpsCommand) {
					await invoke('send_server_command', {
						directory: serverDirectory,
						command: 'tps',
					});
				}
				if (providerCapabilities.supportsVersionCommand) {
					await invoke('send_server_command', {
						directory: serverDirectory,
						command: 'version',
					});
				}
			} catch {}
		})();

		const timer = window.setInterval(async () => {
			try {
				await invoke('send_server_command', {
					directory: serverDirectory,
					command: 'list',
				});
				if (providerCapabilities.supportsTpsCommand) {
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
	}, [
		providerCapabilities.supportsTpsCommand,
		providerCapabilities.supportsVersionCommand,
		serverDirectory,
		serverStatus,
	]);

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
		clearTerminalSession();
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
		clearTerminalSession,
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
		clearTerminalSession();
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
		clearTerminalSession,
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
			if (serverStatus !== 'online' || isBusy) return;

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
