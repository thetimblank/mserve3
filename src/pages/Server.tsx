import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createServerId, useServers } from '@/data/servers';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
	ArrowDownToLine,
	ArrowLeft,
	Boxes,
	CircleCheck,
	Clock,
	Globe,
	MemoryStick,
	OctagonX,
	Package,
	Plug,
	RefreshCcw,
	Trash,
	Users,
	Eye,
	EyeOff,
} from 'lucide-react';
import ServerStatus from '@/components/server-status';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import OpenFolderButton from '@/components/open-folder-button';
import ServerItemList from '@/components/server-item-list';
import {
	getPrimaryMinecraftVersion,
	isServerReadyLine,
	parseListPlayers,
	parseTps,
	parseVersion,
	shouldHideBackgroundLine,
	stripAnsi,
} from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import ServerTerminalPanel from './server/server-terminal-panel';
import ServerContentTabs from './server/server-content-tabs';
import ServerBackupsTab from './server/server-backups-tab';
import EditServerPropertiesButton from '@/components/edit-server-properties-button';
import {
	type RuntimeStatusResult,
	type ScanServerContentsResult,
	type ServerContentTab,
	type ServerOutputEvent,
} from './server/server-types';
import { repairServerMserveJson, syncServerMserveJson } from '@/lib/mserve-sync';
import { requestMserveRepair } from '@/lib/mserve-repair-controller';
import {
	didRequestStop,
	formatUptime,
	getBackupNameFromPath,
	isStopCommand,
	makeCloseBackupKey,
	mapScannedBackups,
} from './server/server-utils';

const terminalSessionStore = new Map<string, string[]>();

const Server: React.FC = () => {
	const navigate = useNavigate();
	const { serverName } = useParams();
	const resolvedServerName = serverName ? decodeURIComponent(serverName) : undefined;
	const { servers, isReady, removeServer, setServerStatus, updateServer, updateServerStats } = useServers();
	const [isBusy, setIsBusy] = React.useState(false);
	const [hideBackgroundTelemetry, setHideBackgroundTelemetry] = React.useState(true);
	const [terminalInput, setTerminalInput] = React.useState('');
	const [terminalLines, setTerminalLines] = React.useState<string[]>([]);
	const [activeTab, setActiveTab] = React.useState<ServerContentTab>('plugins');
	const terminalOutputRef = React.useRef<HTMLDivElement>(null);
	const startAtRef = React.useRef<Date | null>(null);
	const lastOutputRef = React.useRef<{ key: string; at: number }>({ key: '', at: 0 });
	const stopRequestedRef = React.useRef(false);
	const restartRequestedRef = React.useRef(false);
	const lastOnStartBackupRef = React.useRef<string>('');
	const lastOnCloseBackupRef = React.useRef<string>('');
	const isAutoRestartingRef = React.useRef(false);
	const manualStopRequestedRef = React.useRef(false);
	const previousStatusRef = React.useRef<'online' | 'offline' | 'starting' | 'closing'>('offline');
	const isCreatingAutoBackupRef = React.useRef(false);

	const server = React.useMemo(
		() => servers.find((item) => item.name === resolvedServerName),
		[servers, resolvedServerName],
	);

	const serverId = server ? createServerId(server.name, server.directory) : '';
	const terminalStoreKey = server?.directory ?? '';

	const clearTerminalSession = React.useCallback(() => {
		terminalSessionStore.delete(terminalStoreKey);
		setTerminalLines([]);
	}, [terminalStoreKey]);

	const appendTerminalLine = React.useCallback(
		(line: string) => {
			setTerminalLines((prev) => {
				const next = [...prev, line].slice(-500);
				terminalSessionStore.set(terminalStoreKey, next);
				return next;
			});
		},
		[terminalStoreKey],
	);

	const syncServerContents = React.useCallback(async () => {
		if (!server) return;
		try {
			const result = await invoke<ScanServerContentsResult>('scan_server_contents', {
				directory: server.directory,
			});
			updateServer(serverId, {
				plugins: result.plugins,
				worlds: result.worlds,
				datapacks: result.datapacks,
				backups: mapScannedBackups(result.backups),
			});
		} catch {}
	}, [server?.directory, serverId, updateServer]);

	const createAutomaticBackup = React.useCallback(
		async (reason: 'on_start' | 'on_close' | 'interval') => {
			if (!server) return;
			if (isCreatingAutoBackupRef.current) return;
			isCreatingAutoBackupRef.current = true;
			try {
				await invoke('create_server_backup', { directory: server.directory });
				if (reason !== 'interval') {
					appendTerminalLine(`[system] Auto backup created (${reason.replace('_', ' ')})`);
				}
				await syncServerContents();
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to create automatic backup.';
				appendTerminalLine(`[system] Auto backup failed: ${message}`);
			} finally {
				isCreatingAutoBackupRef.current = false;
			}
		},
		[appendTerminalLine, server?.directory, syncServerContents],
	);

	React.useEffect(() => {
		setTerminalLines(terminalSessionStore.get(terminalStoreKey) ?? []);
	}, [terminalStoreKey]);

	React.useEffect(() => {
		syncServerContents();
	}, [syncServerContents]);

	React.useEffect(() => {
		if (!server) return;
		let unlisten: UnlistenFn | null = null;
		let active = true;

		listen<ServerOutputEvent>('server-output', (event) => {
			if (!active) return;
			if (event.payload.directory !== server.directory) {
				return;
			}
			if (event.payload.stream !== 'stdout') {
				return;
			}

			const cleaned = stripAnsi(event.payload.line);
			const dedupeKey = `${event.payload.stream}:${cleaned}`;
			const now = Date.now();
			if (lastOutputRef.current.key === dedupeKey && now - lastOutputRef.current.at < 250) {
				return;
			}
			lastOutputRef.current = { key: dedupeKey, at: now };

			if (isServerReadyLine(cleaned)) {
				setServerStatus(serverId, 'online');
				if (!startAtRef.current) {
					startAtRef.current = new Date();
				}
				updateServerStats(serverId, { uptime: startAtRef.current });
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
				updateServerStats(serverId, {
					tps: tpsInfo.tps,
				});
			}

			const versionInfo = parseVersion(cleaned);
			if (versionInfo) {
				updateServer(serverId, {
					version: versionInfo,
				});
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
		server?.directory,
		serverId,
		setServerStatus,
		updateServer,
		updateServerStats,
	]);

	React.useEffect(() => {
		if (!server) return;
		if (server.status === 'offline') return;

		const timer = window.setInterval(async () => {
			try {
				const runtime = await invoke<RuntimeStatusResult>('get_server_runtime_status', {
					directory: server.directory,
				});
				if (!runtime.running) {
					const stopWasRequested = didRequestStop(
						stopRequestedRef.current,
						restartRequestedRef.current,
						manualStopRequestedRef.current,
					);
					const closeBackupKey = makeCloseBackupKey(serverId, runtime.exitCode);

					if (
						!stopWasRequested &&
						server.auto_backup?.includes('on_close') &&
						lastOnCloseBackupRef.current !== closeBackupKey
					) {
						lastOnCloseBackupRef.current = closeBackupKey;
						await createAutomaticBackup('on_close');
					}

					if (!stopWasRequested && server.auto_restart && !isAutoRestartingRef.current) {
						isAutoRestartingRef.current = true;
						setServerStatus(serverId, 'starting');
						appendTerminalLine('[system] Server closed. Auto restart is enabled, starting again...');
						startAtRef.current = new Date();
						updateServerStats(serverId, {
							players: 0,
							tps: 0,
							uptime: startAtRef.current,
						});

						try {
							await invoke('start_server', { directory: server.directory });
							await syncServerContents();
							isAutoRestartingRef.current = false;
							return;
						} catch {
							isAutoRestartingRef.current = false;
						}
					}

					setServerStatus(serverId, 'offline');
					updateServerStats(serverId, { players: 0, tps: 0, uptime: null });
					clearTerminalSession();
					startAtRef.current = null;
					manualStopRequestedRef.current = false;
				}
			} catch {}
		}, 2000);

		return () => {
			window.clearInterval(timer);
		};
	}, [
		appendTerminalLine,
		clearTerminalSession,
		createAutomaticBackup,
		server?.auto_backup,
		server?.auto_restart,
		server?.directory,
		server?.status,
		serverId,
		setServerStatus,
		syncServerContents,
		updateServerStats,
	]);

	React.useEffect(() => {
		if (!server) return;
		if (server.status !== 'online') return;

		void (async () => {
			try {
				await invoke('send_server_command', {
					directory: server.directory,
					command: 'list',
				});
				await invoke('send_server_command', {
					directory: server.directory,
					command: 'tps',
				});
				await invoke('send_server_command', {
					directory: server.directory,
					command: 'version',
				});
			} catch {}
		})();

		const timer = window.setInterval(async () => {
			try {
				await invoke('send_server_command', {
					directory: server.directory,
					command: 'list',
				});
				await invoke('send_server_command', {
					directory: server.directory,
					command: 'tps',
				});
			} catch {}
		}, 15000);

		return () => {
			window.clearInterval(timer);
		};
	}, [server?.directory, server?.status]);

	React.useEffect(() => {
		if (!server) return;
		const becameOnline = previousStatusRef.current !== 'online' && server.status === 'online';
		if (becameOnline && server.auto_backup?.includes('on_start')) {
			lastOnStartBackupRef.current = `${serverId}:${Date.now()}`;
			void createAutomaticBackup('on_start');
		}

		previousStatusRef.current = server.status;
	}, [createAutomaticBackup, server?.auto_backup, server?.status, serverId]);

	React.useEffect(() => {
		if (!server) return;
		if (server.status !== 'online') return;
		if (!server.auto_backup?.includes('interval')) return;

		const intervalMs = Math.max(1, server.auto_backup_interval ?? 1) * 60_000;
		const timer = window.setInterval(() => {
			void createAutomaticBackup('interval');
		}, intervalMs);

		return () => {
			window.clearInterval(timer);
		};
	}, [createAutomaticBackup, server?.auto_backup, server?.auto_backup_interval, server?.status]);

	React.useEffect(() => {
		const node = terminalOutputRef.current;
		if (!node) return;
		node.scrollTop = node.scrollHeight;
	}, [terminalLines]);

	const handleItemsChanged = React.useCallback(async () => {
		await syncServerContents();
	}, [syncServerContents]);

	const handleDeleteBackup = React.useCallback(
		async (backupDirectory: string) => {
			if (!server) return;
			if (isBusy || server.status === 'online') return;

			setIsBusy(true);
			try {
				await invoke('delete_server_backup', {
					payload: {
						directory: server.directory,
						backupDirectory,
					},
				});
				await syncServerContents();
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to delete backup.';
				window.alert(message);
			} finally {
				setIsBusy(false);
			}
		},
		[isBusy, server?.directory, server?.status, syncServerContents],
	);

	if (!isReady) {
		return (
			<main className='pt-15 min-h-[calc(100vh-40px)] p-12 w-full overflow-y-auto'>
				<div className='text-muted-foreground'>Loading server...</div>
			</main>
		);
	}

	if (!server) {
		return (
			<main className='pt-15 min-h-[calc(100vh-40px)] p-12 w-full overflow-y-auto'>
				<div className='text-muted-foreground'>Server "{resolvedServerName ?? 'Unknown'}" not found.</div>
				<div className='mt-6'>
					<Button asChild variant='outline'>
						<Link to='/servers'>Back to All Servers</Link>
					</Button>
				</div>
			</main>
		);
	}

	const handleStart = async () => {
		if (isBusy) return;
		manualStopRequestedRef.current = false;
		stopRequestedRef.current = false;
		restartRequestedRef.current = false;
		setIsBusy(true);
		clearTerminalSession();
		startAtRef.current = new Date();
		updateServerStats(serverId, { players: 0, tps: 0, uptime: startAtRef.current });
		setServerStatus(serverId, 'starting');
		appendTerminalLine('[system] Starting server...');
		try {
			await invoke('start_server', { directory: server.directory });
			await syncServerContents();
		} catch (err) {
			setServerStatus(serverId, 'offline');
			clearTerminalSession();
			startAtRef.current = null;
			updateServerStats(serverId, { players: 0, tps: 0, uptime: null });
			const message = err instanceof Error ? err.message : 'Failed to start server.';
			appendTerminalLine(`[system] ${message}`);
			window.alert(message);
		} finally {
			setIsBusy(false);
		}
	};

	const handleStop = async () => {
		if (isBusy) return;
		manualStopRequestedRef.current = true;
		stopRequestedRef.current = true;
		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		appendTerminalLine('[system] Stopping server...');
		try {
			await invoke('stop_server', { directory: server.directory });
			if (server.auto_backup?.includes('on_close')) {
				await createAutomaticBackup('on_close');
				lastOnCloseBackupRef.current = `${serverId}:${Date.now()}`;
			}
			setServerStatus(serverId, 'offline');
			clearTerminalSession();
			startAtRef.current = null;
			updateServerStats(serverId, { players: 0, tps: 0, uptime: null });
			await syncServerContents();
		} catch (err) {
			setServerStatus(serverId, 'offline');
			clearTerminalSession();
			startAtRef.current = null;
			updateServerStats(serverId, { players: 0, tps: 0, uptime: null });
			const message = err instanceof Error ? err.message : 'Failed to stop server.';
			appendTerminalLine(`[system] ${message}`);
		} finally {
			stopRequestedRef.current = false;
			setIsBusy(false);
		}
	};

	const handleRestart = async () => {
		if (isBusy) return;
		manualStopRequestedRef.current = false;
		restartRequestedRef.current = true;
		stopRequestedRef.current = true;
		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		clearTerminalSession();
		appendTerminalLine('[system] Restarting server...');
		try {
			await invoke('stop_server', { directory: server.directory });
			if (server.auto_backup?.includes('on_close')) {
				await createAutomaticBackup('on_close');
				lastOnCloseBackupRef.current = `${serverId}:${Date.now()}`;
			}
		} catch {}

		startAtRef.current = new Date();
		updateServerStats(serverId, { players: 0, tps: 0, uptime: startAtRef.current });
		setServerStatus(serverId, 'starting');
		try {
			await invoke('start_server', { directory: server.directory });
			await syncServerContents();
		} catch (err) {
			setServerStatus(serverId, 'offline');
			clearTerminalSession();
			startAtRef.current = null;
			updateServerStats(serverId, { players: 0, tps: 0, uptime: null });
			const message = err instanceof Error ? err.message : 'Failed to restart server.';
			appendTerminalLine(`[system] ${message}`);
			window.alert(message);
		} finally {
			restartRequestedRef.current = false;
			stopRequestedRef.current = false;
			setIsBusy(false);
		}
	};

	const handleTerminalCommandSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (server.status !== 'online' || isBusy) return;

		const command = terminalInput.trim();
		if (!command) return;

		setTerminalInput('');
		appendTerminalLine(`> ${command}`);

		if (isStopCommand(command)) {
			setServerStatus(serverId, 'closing');
		}

		try {
			await invoke('send_server_command', {
				directory: server.directory,
				command,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to send command.';
			appendTerminalLine(`[system] ${message}`);
			window.alert(message);
		}
	};

	const handleDelete = async () => {
		if (isBusy) return;

		setIsBusy(true);
		try {
			await invoke('delete_server', { directory: server.directory });
			clearTerminalSession();
			removeServer(serverId);
			navigate('/servers');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to delete server.';
			window.alert(message);
		} finally {
			setIsBusy(false);
		}
	};

	const handleCreateBackup = async () => {
		if (isBusy || server.status === 'online') return;
		setIsBusy(true);
		try {
			await invoke('create_server_backup', { directory: server.directory });
			await syncServerContents();
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to create backup.';
			window.alert(message);
		} finally {
			setIsBusy(false);
		}
	};

	const handleManualSync = async () => {
		if (isBusy || server.status !== 'offline') return;

		setIsBusy(true);
		try {
			let synced = await syncServerMserveJson(server.directory);

			if (synced.status === 'needs_setup') {
				const repairPayload = await requestMserveRepair({
					directory: server.directory,
					file: server.file,
					ram: server.ram ?? 3,
					auto_backup: server.auto_backup ?? [],
					auto_backup_interval: server.auto_backup_interval ?? 120,
					auto_restart: server.auto_restart ?? false,
					explicit_info_names: server.explicit_info_names ?? false,
					custom_flags: server.custom_flags ?? [],
				});

				if (!repairPayload) {
					toast.error('Sync cancelled. mserve.json rebuild was not completed.');
					return;
				}

				synced = await repairServerMserveJson(repairPayload);
			}

			if (!synced.config) {
				throw new Error('Valid mserve.json data could not be resolved.');
			}

			updateServer(serverId, {
				file: synced.config.file,
				ram: synced.config.ram,
				auto_backup: synced.config.auto_backup,
				auto_backup_interval: synced.config.auto_backup_interval,
				auto_restart: synced.config.auto_restart,
				explicit_info_names: synced.config.explicit_info_names,
				custom_flags: synced.config.custom_flags,
				provider: synced.config.provider,
				version: synced.config.version,
				createdAt: new Date(synced.config.createdAt),
			});

			toast.success(synced.message);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to sync mserve.json.';
			toast.error(message);
		} finally {
			setIsBusy(false);
		}
	};

	const handleRestoreBackup = async (backupDirectory: string) => {
		if (isBusy || server.status === 'online') return;

		setIsBusy(true);
		try {
			const backupName = getBackupNameFromPath(backupDirectory);
			toast.promise(
				(async () => {
					await invoke('restore_server_backup', {
						payload: {
							directory: server.directory,
							backupDirectory,
						},
					});
					await syncServerContents();
					return { backupName };
				})(),
				{
					loading: 'Creating backup of current state and restoring...',
					success: (data) => `Backup created and ${data.backupName} has been restored`,
					error: (err) => (err instanceof Error ? err.message : 'Failed to restore backup.'),
				},
			);
		} finally {
			setIsBusy(false);
		}
	};

	return (
		<main className='w-full min-h-[calc(100vh-40px)] relative overflow-y-auto'>
			<div className='min-h-full flex flex-col p-12 pt-20 w-full overflow-y-auto'>
				<div className='flex items-center justify-between mb-8'>
					<div>
						<div className='flex gap-2 items-center'>
							<Link to='/'>
								<ArrowLeft className='size-8' />
							</Link>

							<h1 className='text-4xl font-bold'>{server.name}</h1>
						</div>
					</div>
				</div>

				<div>
					<ServerTerminalPanel
						isVisible={server.status !== 'offline'}
						isBusy={isBusy}
						status={server.status}
						terminalLines={terminalLines}
						terminalInput={terminalInput}
						onTerminalInputChange={setTerminalInput}
						onSubmit={handleTerminalCommandSubmit}
						terminalOutputRef={terminalOutputRef}
					/>
				</div>
				<div className='mt-4 mb-8'>
					<div className='flex gap-10'>
						<ServerStatus server={server} size='xl' />
						<div className='flex flex-col'>
							<div className='flex gap-2 mb-2 flex-wrap'>
								{server.status === 'online' && (
									<Button onClick={handleStop} disabled={isBusy}>
										<OctagonX />
										<p>Stop</p>
									</Button>
								)}
								{server.status === 'online' && (
									<Button variant='secondary' onClick={handleRestart} disabled={isBusy}>
										<RefreshCcw />
										<p>Restart</p>
									</Button>
								)}
								{server.status === 'offline' && (
									<Button onClick={handleStart} disabled={isBusy}>
										<CircleCheck />
										<p>Serve</p>
									</Button>
								)}
								<Button
									variant='secondary'
									onClick={() => setHideBackgroundTelemetry((prev) => !prev)}
									disabled={isBusy}>
									{hideBackgroundTelemetry ? <Eye /> : <EyeOff />}
									{hideBackgroundTelemetry ? 'Show Status Check logs' : 'Hide Status Check logs'}
								</Button>
								<OpenFolderButton directory={server.directory} disabled={isBusy} />
								<Button
									variant='secondary'
									onClick={handleManualSync}
									disabled={isBusy || server.status !== 'offline'}>
									<RefreshCcw />
									<p>Sync mserve.json</p>
								</Button>
								<EditServerPropertiesButton
									server={server}
									disabled={isBusy}
									onSaved={syncServerContents}
								/>

								<AlertDialog>
									<AlertDialogTrigger asChild>
										<Button
											disabled={isBusy || server.status === 'online'}
											variant='destructive-secondary'>
											<Trash />
											<p>Remove Server</p>
										</Button>
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>Are you sure?</AlertDialogTitle>
											<AlertDialogDescription>
												This will remove the server from the MSERVE app. It will lose it&apos;s
												data associated with the app. However, it will NOT delete any files and it
												will NOT remove mserve.json. You can always import the server again.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Cancel</AlertDialogCancel>
											<AlertDialogAction
												variant='destructive'
												// TODO: complete this function
												className='capitalize'>
												Remove Server
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<Button
											disabled={isBusy || server.status === 'online'}
											variant='destructive-secondary'>
											<Trash />
											<p>Delete Server</p>
										</Button>
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>Are you sure?</AlertDialogTitle>
											<AlertDialogDescription>
												This will move the server to the recycling bin.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Cancel</AlertDialogCancel>
											<AlertDialogAction
												variant='destructive'
												className='capitalize'
												onClick={handleDelete}>
												Delete Server
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							</div>
							<div className='flex items-center gap-2 mb-1'>
								{server.createdAt && (
									<p className='text-sm text-muted-foreground'>
										Server was created {new Date(server.createdAt).toLocaleDateString()}
									</p>
								)}
								{server.createdAt && server.status !== 'offline' && (
									<p className='text-sm text-muted-foreground'>•</p>
								)}
								{server.status !== 'offline' && (
									<p className='text-sm text-muted-foreground'>
										Note: Some features may be unavailiable when the server is online
									</p>
								)}
							</div>
							{server.status === 'online' && (
								<div className='flex items-center lg:text-lg gap-2'>
									<Users className='size-5' />
									Players: {server.stats.players}/{server.stats.capacity}
								</div>
							)}
							{server.auto_restart && (
								<div className='flex items-center lg:text-lg gap-2'>
									<RefreshCcw className='size-5' />
									<p>
										Server automatically <span className='font-bold'>restarts on shutdown</span>.
									</p>
								</div>
							)}
							{server.version && (
								<div className='flex items-center lg:text-lg gap-2'>
									<ArrowDownToLine className='size-5' />
									{(() => {
										const primary = getPrimaryMinecraftVersion(server.version);
										if (!primary) return <span>{server.version}</span>;
										return (
											<p className='flex items-baseline'>
												<Tooltip>
													<TooltipTrigger>
														<p>
															The server version is{' '}
															<span className='font-bold'>{primary}</span>.
														</p>
													</TooltipTrigger>
													<TooltipContent className='max-w-40 text-warp text-white dark:text-black'>
														{server.version}
													</TooltipContent>
												</Tooltip>
											</p>
										);
									})()}
								</div>
							)}
							{server.ram && (
								<div className='flex items-center lg:text-lg gap-2'>
									<MemoryStick className='size-5' />
									<p>
										The server has <span className='font-bold'>{server.ram}GB</span> of memory.
									</p>
								</div>
							)}
							<div className='flex items-center lg:text-lg gap-2'>
								<Boxes className='size-5' />
								<p>
									The server jar file is <span className='font-bold'>{server.file}</span>.
								</p>
							</div>
							{server.status === 'online' && server.stats.uptime && (
								<div className='flex items-center lg:text-lg gap-2'>
									<Clock className='size-5' />
									Uptime: {formatUptime(server.stats.uptime)}
								</div>
							)}
						</div>
					</div>
				</div>

				<ServerContentTabs activeTab={activeTab} onTabChange={setActiveTab} />

				{activeTab === 'plugins' && (
					<ServerItemList
						icon={<Plug />}
						type='plugin'
						serverDirectory={server.directory}
						title='Plugins'
						searchPlaceholder='Search for Plugin...'
						emptyLabel='No Plugins were found.'
						items={server.plugins}
						onChanged={handleItemsChanged}
						disabled={isBusy || server.status === 'online'}
						ctaLabel='Download More'
						ctaUrl='https://modrinth.com/discover/plugins'
					/>
				)}
				{activeTab === 'worlds' && (
					<ServerItemList
						icon={<Globe />}
						type='world'
						serverDirectory={server.directory}
						title='Worlds'
						searchPlaceholder='Search for World...'
						emptyLabel='No Worlds were found.'
						items={server.worlds}
						onChanged={handleItemsChanged}
						disabled={isBusy || server.status === 'online'}
					/>
				)}
				{activeTab === 'datapacks' && (
					<ServerItemList
						icon={<Package />}
						type='datapack'
						serverDirectory={server.directory}
						title='Datapacks'
						searchPlaceholder='Search for Datapack...'
						emptyLabel='No Datapacks were found.'
						items={server.datapacks}
						onChanged={handleItemsChanged}
						disabled={isBusy || server.status === 'online'}
						ctaLabel='Add More'
						ctaUrl='https://modrinth.com/discover/datapacks'
					/>
				)}
				{activeTab === 'backups' && (
					<ServerBackupsTab
						server={server}
						backups={server.backups}
						isBusy={isBusy}
						isOnline={server.status === 'online'}
						onCreateBackup={handleCreateBackup}
						onRestoreBackup={handleRestoreBackup}
						onDeleteBackup={handleDeleteBackup}
					/>
				)}
			</div>
		</main>
	);
};

export default Server;
