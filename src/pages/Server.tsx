import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createServerId, type Server as MserveServer, useServers } from '@/data/servers';
import { Button } from '@/components/ui/button';
import {
	ArrowDownToLine,
	ArrowLeft,
	ArchiveRestore,
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
} from 'lucide-react';
import ServerStatus from '@/components/server-status';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import OpenFolderButton from '@/components/open-folder-button';
import ServerItemList from '@/components/server-item-list';
import { ButtonGroup } from '@/components/ui/button-group';
import {
	getPrimaryMinecraftVersion,
	isServerReadyLine,
	parseListPlayers,
	parseTps,
	parseVersion,
	shouldHideBackgroundLine,
	stripAnsi,
} from '@/lib/utils';

type ServerOutputEvent = {
	directory: string;
	stream: string;
	line: string;
};

type ScanServerContentsResult = {
	plugins: MserveServer['plugins'];
	worlds: MserveServer['worlds'];
	datapacks: MserveServer['datapacks'];
	backups: { directory: string; createdAt?: string; created_at?: string }[];
};

type RuntimeStatusResult = {
	running: boolean;
	exitCode: number | null;
};

type ServerContentTab = 'plugins' | 'worlds' | 'datapacks' | 'backups';

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

	const server = React.useMemo(
		() => servers.find((item) => item.name === resolvedServerName),
		[servers, resolvedServerName],
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

	const serverId = createServerId(server.name, server.directory);
	const terminalStoreKey = server.directory;

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
		try {
			const result = await invoke<ScanServerContentsResult>('scan_server_contents', {
				directory: server.directory,
			});
			updateServer(serverId, {
				plugins: result.plugins,
				worlds: result.worlds,
				datapacks: result.datapacks,
				backups: result.backups.map((backup) => ({
					directory: backup.directory,
					createdAt: new Date(backup.createdAt ?? backup.created_at ?? Date.now()),
				})),
			});
		} catch {}
	}, [server.directory, serverId, updateServer]);

	React.useEffect(() => {
		setTerminalLines(terminalSessionStore.get(terminalStoreKey) ?? []);
	}, [terminalStoreKey]);

	React.useEffect(() => {
		syncServerContents();
	}, [syncServerContents]);

	React.useEffect(() => {
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
		server.directory,
		serverId,
		setServerStatus,
		updateServer,
		updateServerStats,
	]);

	React.useEffect(() => {
		if (server.status === 'offline') return;

		const timer = window.setInterval(async () => {
			try {
				const runtime = await invoke<RuntimeStatusResult>('get_server_runtime_status', {
					directory: server.directory,
				});
				if (!runtime.running) {
					setServerStatus(serverId, 'offline');
					updateServerStats(serverId, { players: 0, tps: 0, uptime: null });
					clearTerminalSession();
					startAtRef.current = null;
				}
			} catch {}
		}, 2000);

		return () => {
			window.clearInterval(timer);
		};
	}, [clearTerminalSession, server.directory, server.status, serverId, setServerStatus, updateServerStats]);

	React.useEffect(() => {
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
	}, [server.directory, server.status]);

	React.useEffect(() => {
		const node = terminalOutputRef.current;
		if (!node) return;
		node.scrollTop = node.scrollHeight;
	}, [terminalLines]);

	const handleStart = async () => {
		if (isBusy) return;
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
		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		appendTerminalLine('[system] Stopping server...');
		try {
			await invoke('stop_server', { directory: server.directory });
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
			setIsBusy(false);
		}
	};

	const handleRestart = async () => {
		if (isBusy) return;
		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		clearTerminalSession();
		appendTerminalLine('[system] Restarting server...');
		try {
			await invoke('stop_server', { directory: server.directory });
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

		if (command.replace(/^\//, '').trim().toLowerCase() === 'stop') {
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
		const confirmed = window.confirm(
			`Move server "${server.name}" to your recycle bin? This removes it from the app too.`,
		);
		if (!confirmed) return;

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

	const handleItemsChanged = React.useCallback(async () => {
		await syncServerContents();
	}, [syncServerContents]);

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

	const handleRestoreBackup = async (backupDirectory: string) => {
		if (isBusy || server.status === 'online') return;
		const confirmed = window.confirm(
			'Restore this backup? This will create a backup of current worlds first and then replace world files.',
		);
		if (!confirmed) return;

		setIsBusy(true);
		try {
			await invoke('restore_server_backup', {
				payload: {
					directory: server.directory,
					backupDirectory,
				},
			});
			await syncServerContents();
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to restore backup.';
			window.alert(message);
		} finally {
			setIsBusy(false);
		}
	};

	return (
		<main className='pt-15 min-h-[calc(100vh-40px)] p-12 w-full overflow-y-auto'>
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

			<div className='flex my-6 gap-4'>
				<div className='flex flex-col gap-2 min-w-40'>
					<ServerStatus server={server} size='xl' />
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
				</div>
				<div className='bg-black rounded-xl w-full flex font-mono flex-col'>
					<div ref={terminalOutputRef} className='h-64 overflow-y-auto px-4 py-2 text-sm space-y-1'>
						{terminalLines.length <= 0 && server.status === 'offline' && (
							<p>Please start the server to see command output.</p>
						)}
						{terminalLines.map((line, index) => (
							<p key={`${index}-${line}`}>{line}</p>
						))}
					</div>
					<form onSubmit={handleTerminalCommandSubmit}>
						<input
							className='w-full outline-none border-t border-muted px-4 py-2'
							placeholder='> '
							value={terminalInput}
							onChange={(event) => setTerminalInput(event.target.value)}
							disabled={server.status !== 'online' || isBusy}
						/>
					</form>
				</div>
			</div>
			<div className='mb-4 border-t border-border pt-4'>
				<div className='flex gap-2 mb-2'>
					<OpenFolderButton directory={server.directory} disabled={isBusy} />
					<Button
						variant={hideBackgroundTelemetry ? 'outline' : 'default'}
						onClick={() => setHideBackgroundTelemetry((prev) => !prev)}
						disabled={isBusy || server.status !== 'online'}>
						{hideBackgroundTelemetry ? 'Show TPS/List/Version logs' : 'Hide TPS/List/Version logs'}
					</Button>
					<Button
						disabled={isBusy || server.status === 'online'}
						variant='destructive'
						onClick={handleDelete}>
						<Trash />
						<p>Delete Server</p>
					</Button>
				</div>
				{server.createdAt && (
					<p className='text-sm text-muted-foreground mb-1'>
						Server was created {new Date(server.createdAt).toLocaleDateString()}
					</p>
				)}
				{server.status === 'online' && (
					<div className='flex items-center lg:text-lg gap-2'>
						<Users className='size-5' />
						Players: {server.stats.players}/{server.stats.capacity}
					</div>
				)}
				{server.version && (
					<div className='flex items-center lg:text-lg gap-2'>
						<ArrowDownToLine className='size-5' />
						{(() => {
							const primary = getPrimaryMinecraftVersion(server.version);
							if (!primary) return <span>{server.version}</span>;
							const index = server.version.indexOf(primary);
							const before = server.version.slice(0, index);
							const after = server.version.slice(index + primary.length);
							return (
								<p className='flex items-baseline'>
									Version: <span className='text-muted-foreground text-xs'>{before}</span>
									<span className='font-semibold'>{primary}</span>
									<span className='text-muted-foreground text-xs'>{after}</span>
								</p>
							);
						})()}
					</div>
				)}
				{server.ram && (
					<div className='flex items-center lg:text-lg gap-2'>
						<MemoryStick className='size-5' />
						Memory: {server.ram}GB
					</div>
				)}
				<div className='flex items-center lg:text-lg gap-2'>
					<Boxes className='size-5' />
					Jar File: {server.file}
				</div>
				{server.status === 'online' && server.stats.uptime && (
					<div className='flex items-center lg:text-lg gap-2'>
						<Clock className='size-5' />
						Uptime:{' '}
						{(() => {
							const now = new Date();
							const diff = now.getTime() - server.stats.uptime.getTime();
							const days = Math.floor(diff / (1000 * 60 * 60 * 24));
							const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
							const minutes = Math.floor((diff / (1000 * 60)) % 60);
							const seconds = Math.floor((diff / 1000) % 60);

							if (days > 0) return `${days}d ${hours}h ${seconds}s`;
							if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
							if (minutes < 0) return `Just started ${seconds}s ago`;
							return `${minutes}m ${seconds}s`;
						})()}
					</div>
				)}
			</div>

			<hr className='w-full border-t border-border' />
			<ButtonGroup className='mb-6 pt-4'>
				<Button
					variant={activeTab === 'plugins' ? 'default' : 'outline'}
					onClick={() => setActiveTab('plugins')}>
					Plugins
				</Button>
				<Button
					variant={activeTab === 'worlds' ? 'default' : 'outline'}
					onClick={() => setActiveTab('worlds')}>
					Worlds
				</Button>
				<Button
					variant={activeTab === 'datapacks' ? 'default' : 'outline'}
					onClick={() => setActiveTab('datapacks')}>
					Datapacks
				</Button>
				<Button
					variant={activeTab === 'backups' ? 'default' : 'outline'}
					onClick={() => setActiveTab('backups')}>
					Backups
				</Button>
			</ButtonGroup>

			{activeTab === 'plugins' && (
				<ServerItemList
					icon={<Plug />}
					type='plugin'
					serverDirectory={server.directory}
					title='Plugins'
					description='See and manage the server plugins here.'
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
					description='See and manage the server worlds here.'
					searchPlaceholder='Search for World...'
					emptyLabel='No Worlds were found.'
					items={server.worlds}
					onChanged={handleItemsChanged}
					disabled={isBusy || server.status === 'online'}
					ctaLabel='Backup Worlds'
					ctaUrl='https://modrinth.com/discover/plugins'
				/>
			)}
			{activeTab === 'datapacks' && (
				<ServerItemList
					icon={<Package />}
					type='datapack'
					serverDirectory={server.directory}
					title='Datapacks'
					description='See and manage the server datapacks here.'
					searchPlaceholder='Search for Datapack...'
					emptyLabel='No Datapacks were found.'
					items={server.datapacks}
					onChanged={handleItemsChanged}
					disabled={isBusy || server.status === 'online'}
					ctaLabel='Add More'
					ctaUrl='https://modrinth.com/discover/plugins'
				/>
			)}
			{activeTab === 'backups' && (
				<div className='flex flex-col gap-4'>
					<div className='flex justify-between items-center'>
						<div>
							<p className='text-3xl font-bold flex items-center gap-2'>
								<ArchiveRestore />
								Backups
							</p>
							<p className='text-muted-foreground'>Restore previous world snapshots.</p>
						</div>
						<Button onClick={handleCreateBackup} disabled={isBusy || server.status === 'online'}>
							Create Backup
						</Button>
					</div>
					{server.backups.length === 0 ? (
						<p className='text-xl text-muted-foreground'>No backups were found.</p>
					) : (
						server.backups.map((backup) => (
							<div
								key={backup.directory}
								className='border border-border rounded-lg p-3 flex items-center justify-between gap-3'>
								<div>
									<p className='font-semibold'>{backup.directory.split(/[\\/]/).pop()}</p>
									<p className='text-sm text-muted-foreground'>
										Created {new Date(backup.createdAt).toLocaleString()}
									</p>
								</div>
								<div className='flex gap-2'>
									<OpenFolderButton targetPath={backup.directory} disabled={isBusy} />
									<Button
										variant='secondary'
										disabled={isBusy || server.status === 'online'}
										onClick={() => handleRestoreBackup(backup.directory)}>
										Restore
									</Button>
								</div>
							</div>
						))
					)}
				</div>
			)}
		</main>
	);
};

export default Server;
