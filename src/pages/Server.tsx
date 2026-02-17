import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createServerId, type Server as MserveServer, useServers } from '@/data/servers';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Archive,
	ArrowLeft,
	ArrowUpRightFromSquare,
	Check,
	CircleCheck,
	Folder,
	HardDrive,
	LinkIcon,
	OctagonX,
	RefreshCcw,
	Trash,
	X,
} from 'lucide-react';
import ServerStatus from '@/components/server-status';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Input } from '@/components/ui/input';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

type ServerOutputEvent = {
	directory: string;
	stream: string;
	line: string;
};

type ScanServerContentsResult = {
	plugins: MserveServer['plugins'];
	worlds: MserveServer['worlds'];
	datapacks: MserveServer['datapacks'];
};

type RuntimeStatusResult = {
	running: boolean;
	exitCode: number | null;
};

const terminalSessionStore = new Map<string, string[]>();

const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '');

const isServerReadyLine = (line: string) => /Done \([\d.]+s\)! For help, type "help"/i.test(line);

const parseListPlayers = (line: string) => {
	const match = line.match(/There are\s+(\d+)\s+of a max of\s+(\d+)\s+players online/i);
	if (!match) return null;
	return {
		players: Number(match[1]),
		capacity: Number(match[2]),
	};
};

const parseTps = (line: string) => {
	const match = line.match(
		/TPS from last 1m, 5m, 15m:\s*([0-9]+(?:\.[0-9]+)?),\s*([0-9]+(?:\.[0-9]+)?),\s*([0-9]+(?:\.[0-9]+)?)/i,
	);
	if (!match) return null;
	return {
		tps: Number(match[1]),
	};
};

const shouldHideBackgroundLine = (cleaned: string) => {
	return cleaned.includes('There are') || cleaned.includes('TPS from last 1m, 5m, 15m:');
};

const Server: React.FC = () => {
	const navigate = useNavigate();
	const { serverName } = useParams();
	const resolvedServerName = serverName ? decodeURIComponent(serverName) : undefined;
	const { servers, isReady, removeServer, setServerStatus, updateServer, updateServerStats } = useServers();
	const [isBusy, setIsBusy] = React.useState(false);
	const [terminalInput, setTerminalInput] = React.useState('');
	const [terminalLines, setTerminalLines] = React.useState<string[]>([]);
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

			if (shouldHideBackgroundLine(cleaned)) {
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
	}, [appendTerminalLine, server.directory, serverId, setServerStatus, updateServerStats]);

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

	const handleOpenFolder = async () => {
		if (isBusy) return;
		setIsBusy(true);
		try {
			await invoke('open_server_folder', { directory: server.directory });
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to open folder.';
			window.alert(message);
		} finally {
			setIsBusy(false);
		}
	};

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

	return (
		<main className='pt-15 min-h-[calc(100vh-40px)] p-12 w-full overflow-y-auto'>
			<div className='flex items-center justify-between mb-8'>
				<div>
					<div className='flex gap-2 items-center'>
						<Link to='/servers'>
							<ArrowLeft className='size-8' />
						</Link>

						<h1 className='text-4xl font-black'>{server.name}</h1>
					</div>
				</div>
				<Button asChild variant='outline'>
					<Link to='/servers'>All Servers</Link>
				</Button>
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
			<div className='mb-16 border-t border-border pt-4'>
				<div className='flex gap-2 mb-2'>
					<Button variant='secondary' onClick={handleOpenFolder} disabled={isBusy}>
						<Folder />
						<p>Open Folder</p>
					</Button>
					<Button variant='destructive' onClick={handleDelete} disabled={isBusy}>
						<Trash />
						<p>Delete Server</p>
					</Button>
				</div>
				{server.createdAt && (
					<p className='text-sm text-muted-foreground mb-1'>
						Server started {new Date(server.createdAt).toLocaleDateString()}
					</p>
				)}
				{server.ram && <p className='text-sm text-muted-foreground mb-1'>Ram {server.ram}</p>}
			</div>

			<div className='grid gap-10 lg:grid-cols-[1.1fr_1fr]'>
				<div className='flex flex-col gap-1'>
					<div className='flex justify-between gap-5'>
						<div className='flex-col gap-1'>
							<p className='text-3xl font-bold'>Plugins</p>
							<p className='text-muted-foreground'>See and manage the server plugins here.</p>
						</div>
						<Button onClick={() => openUrl('https://modrinth.com/discover/plugins')}>
							Download More
							<ArrowUpRightFromSquare />
						</Button>
					</div>
					<Input type='search' placeholder='Search for Plugin...' />
					<div className='flex flex-col gap-4 mt-4'>
						{server.plugins.length <= 0 ? (
							<p className='text-xl text-muted-foreground'>No Plugins were found.</p>
						) : (
							server.plugins.map((plugin, i) => (
								<Card key={i}>
									<CardHeader className='border-b border-b-border'>
										<CardTitle>{plugin.name ?? plugin.file}</CardTitle>
										<CardDescription className='flex gap-6'>
											{plugin.activated ? (
												<div className='flex items-center font-bold lg:text-lg gap-1 text-green-500'>
													<Check className='size-4' />
													Active
												</div>
											) : (
												<div className='flex items-center font-bold lg:text-lg gap-1 text-red-400'>
													<X className='size-4' />
													Inactive
												</div>
											)}
											{plugin.size && (
												<div className='flex items-center lg:text-lg gap-1'>
													<HardDrive className='size-4' />
													{plugin.size > 100000
														? `${(plugin.size / 1048576).toFixed(2)}TB`
														: plugin.size > 1000
															? `${(plugin.size / 1024).toFixed(2)}GB`
															: `${plugin.size}MB`}
												</div>
											)}
											{plugin.url && (
												<div className='flex items-center lg:text-lg gap-1'>
													<LinkIcon className='size-4' />
													{plugin.url}
												</div>
											)}
										</CardDescription>
									</CardHeader>
									<CardContent className='flex gap-2'>
										<Button variant='secondary' onClick={handleOpenFolder} disabled={isBusy}>
											Open Folder
										</Button>
										{plugin.activated ? (
											<Button variant='secondary'>Deactivate</Button>
										) : (
											<Button variant='secondary'>Activate</Button>
										)}
										<Button variant='destructive'>Uninstall</Button>
									</CardContent>
								</Card>
							))
						)}
					</div>
				</div>
				<div className='flex flex-col gap-1'>
					<div className='flex justify-between gap-5'>
						<div className='flex-col gap-1'>
							<p className='text-3xl font-bold'>Worlds</p>
							<p className='text-muted-foreground'>See and manage the server worlds here.</p>
						</div>
						<Button onClick={() => openUrl('https://modrinth.com/discover/plugins')}>
							Backup Worlds
							<Archive />
						</Button>
					</div>
					<Input type='search' placeholder='Search for Plugin...' />
					<div className='flex flex-col gap-4 mt-4'>
						{server.worlds.length <= 0 ? (
							<p className='text-xl text-muted-foreground'>No Worlds were found.</p>
						) : (
							server.worlds.map((world, i) => (
								<Card key={i}>
									<CardHeader className='border-b border-b-border'>
										<CardTitle>{world.name ?? world.file}</CardTitle>
										<CardDescription className='flex gap-6'>
											{world.activated ? (
												<div className='flex items-center font-bold lg:text-lg gap-1 text-green-500'>
													<Check className='size-4' />
													Active
												</div>
											) : (
												<div className='flex items-center font-bold lg:text-lg gap-1 text-red-400'>
													<X className='size-4' />
													Inactive
												</div>
											)}
											{world.size && (
												<div className='flex items-center lg:text-lg gap-1'>
													<HardDrive className='size-4' />
													{world.size > 100000
														? `${(world.size / 1048576).toFixed(2)}TB`
														: world.size > 1000
															? `${(world.size / 1024).toFixed(2)}GB`
															: `${world.size}MB`}
												</div>
											)}
										</CardDescription>
										<CardAction></CardAction>
									</CardHeader>
									<CardContent className='flex gap-2'>
										<Button variant='secondary'>Export</Button>
										<Button variant='secondary' onClick={handleOpenFolder} disabled={isBusy}>
											Open Folder
										</Button>
										{world.activated ? (
											<Button variant='secondary'>Deactivate</Button>
										) : (
											<Button variant='secondary'>Activate</Button>
										)}
										<Button variant='destructive'>Delete</Button>
									</CardContent>
								</Card>
							))
						)}
					</div>
				</div>
				<div className='flex flex-col gap-1'>
					<div className='flex justify-between gap-5'>
						<div className='flex-col gap-1'>
							<p className='text-3xl font-bold'>Datapacks</p>
							<p className='text-muted-foreground'>See and manage the server datapacks here.</p>
						</div>
						<Button onClick={() => openUrl('https://modrinth.com/discover/plugins')}>
							Add More
							<ArrowUpRightFromSquare />
						</Button>
					</div>
					<Input type='search' placeholder='Search for Plugin...' />
					<div className='flex flex-col gap-4 mt-4'>
						{server.datapacks.length <= 0 ? (
							<p className='text-xl text-muted-foreground'>No Datapacks were found.</p>
						) : (
							server.datapacks.map((datapack, i) => (
								<Card key={i}>
									<CardHeader className='border-b border-b-border'>
										<CardTitle>{datapack.name ?? datapack.file}</CardTitle>
										<CardDescription>50mb</CardDescription>
										<CardAction></CardAction>
									</CardHeader>
									<CardContent className='flex gap-2'>
										<Button variant='secondary'>Uninstall</Button>
										<Button variant='secondary'>Unload</Button>
										<Button variant='secondary' onClick={handleOpenFolder} disabled={isBusy}>
											Open Folder
										</Button>
									</CardContent>
								</Card>
							))
						)}
					</div>
				</div>
			</div>
		</main>
	);
};

export default Server;
