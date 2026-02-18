import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createServerId, Server, useServers } from '@/data/servers';
import {
	ArrowDownToLine,
	Boxes,
	CircleCheck,
	Clock,
	MemoryStick,
	OctagonX,
	RefreshCcw,
	Users,
} from 'lucide-react';
import React from 'react';
import { m } from 'motion/react';
import { Link } from 'react-router-dom';
import ServerStatus from './server-status';
import { invoke } from '@tauri-apps/api/core';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import OpenFolderButton from '@/components/open-folder-button';
import { getPrimaryMinecraftVersion } from '@/lib/utils';
import EditServerPropertiesButton from '@/components/edit-server-properties-button';

interface Props {
	server: Server;
	delay?: number;
}

const ServerCard: React.FC<Props> = ({ server, delay }) => {
	const { setServerStatus, updateServerStats } = useServers();
	const [isBusy, setIsBusy] = React.useState(false);
	const serverId = createServerId(server.name, server.directory);

	const handleStart = async () => {
		if (isBusy) return;
		setIsBusy(true);
		setServerStatus(serverId, 'starting');
		updateServerStats(serverId, { players: 0, tps: 0, uptime: new Date() });
		try {
			await invoke('start_server', { directory: server.directory });
			setServerStatus(serverId, 'online');
		} catch (err) {
			setServerStatus(serverId, 'offline');
			const message = err instanceof Error ? err.message : 'Failed to start server.';
			window.alert(message);
		} finally {
			setIsBusy(false);
		}
	};

	const handleStop = async () => {
		if (isBusy) return;
		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		try {
			await invoke('stop_server', { directory: server.directory });
			setServerStatus(serverId, 'offline');
			updateServerStats(serverId, { players: 0, tps: 0, uptime: null });
		} catch (err) {
			setServerStatus(serverId, 'offline');
			updateServerStats(serverId, { players: 0, tps: 0, uptime: null });
			const message = err instanceof Error ? err.message : 'Failed to stop server.';
			window.alert(message);
		} finally {
			setIsBusy(false);
		}
	};

	const handleRestart = async () => {
		if (isBusy) return;
		setIsBusy(true);
		setServerStatus(serverId, 'closing');
		try {
			await invoke('stop_server', { directory: server.directory });
		} catch {}

		setServerStatus(serverId, 'starting');
		updateServerStats(serverId, { players: 0, tps: 0, uptime: new Date() });
		try {
			await invoke('start_server', { directory: server.directory });
			setServerStatus(serverId, 'online');
		} catch (err) {
			setServerStatus(serverId, 'offline');
			updateServerStats(serverId, { players: 0, tps: 0, uptime: null });
			const message = err instanceof Error ? err.message : 'Failed to restart server.';
			window.alert(message);
		} finally {
			setIsBusy(false);
		}
	};

	return (
		<m.div
			initial={{ y: 50, opacity: 0 }}
			whileInView={{ y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0, delay: delay }}>
			<Card>
				<CardHeader className='border-b border-b-border'>
					<CardTitle className='text-3xl'>{server.name}</CardTitle>
					<CardDescription className='flex gap-6'>
						{server.status === 'online' && (
							<Tooltip>
								<TooltipTrigger>
									<div className='flex items-center lg:text-lg gap-2'>
										<Users className='size-5' />
										{server.stats.players}/{server.stats.capacity}
									</div>
								</TooltipTrigger>
								<TooltipContent>
									<p className='font-bold'>Players Online out of Player Capacity</p>
								</TooltipContent>
							</Tooltip>
						)}
						{server.version && (
							<Tooltip>
								<TooltipTrigger>
									<div className='flex items-center lg:text-lg gap-2'>
										<ArrowDownToLine className='size-5' />
										{getPrimaryMinecraftVersion(server.version) ?? server.version}
									</div>
								</TooltipTrigger>
								<TooltipContent>
									<p className='font-bold'>Server Version</p>
								</TooltipContent>
							</Tooltip>
						)}
						{server.ram && (
							<Tooltip>
								<TooltipTrigger>
									<div className='flex items-center lg:text-lg gap-2'>
										<MemoryStick className='size-5' />
										{server.ram}GB
									</div>
								</TooltipTrigger>
								<TooltipContent>
									<p className='font-bold'>Server Memory (RAM)</p>
								</TooltipContent>
							</Tooltip>
						)}
						<Tooltip>
							<TooltipTrigger>
								<div className='flex items-center lg:text-lg gap-2'>
									<Boxes className='size-5' />
									{server.file}
								</div>
							</TooltipTrigger>
							<TooltipContent>
								<p className='font-bold'>Server Jar File</p>
							</TooltipContent>
						</Tooltip>
						{server.status === 'online' && server.stats.uptime && (
							<Tooltip>
								<TooltipTrigger>
									<div className='flex items-center lg:text-lg gap-1'>
										<Clock className='size-4' />
										{(() => {
											const now = new Date();
											const diff = now.getTime() - server.stats.uptime.getTime();
											const days = Math.floor(diff / (1000 * 60 * 60 * 24));
											const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
											const minutes = Math.floor((diff / (1000 * 60)) % 60);

											if (days > 0) return `${days}d ${hours}h`;
											if (hours > 0) return `${hours}h ${minutes}m`;
											if (minutes < 1) return `Now`;
											return `${minutes}m`;
										})()}
									</div>
								</TooltipTrigger>
								<TooltipContent>
									<p className='font-bold'>Server Uptime</p>
								</TooltipContent>
							</Tooltip>
						)}
					</CardDescription>
					<CardAction>
						<ServerStatus server={server} />
					</CardAction>
				</CardHeader>
				<CardContent>
					<div className='flex items-center gap-2'>
						<Link to={`/servers/${encodeURIComponent(server.name)}`}>
							<Button>View More Details</Button>
						</Link>
						{server.status === 'online' && (
							<Button variant='secondary' onClick={handleStop} disabled={isBusy}>
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
							<Button variant='secondary' onClick={handleStart} disabled={isBusy}>
								<CircleCheck />
								<p>Start</p>
							</Button>
						)}
						<EditServerPropertiesButton server={server} disabled={isBusy} />
						<OpenFolderButton directory={server.directory} disabled={isBusy} />
					</div>
				</CardContent>
			</Card>
		</m.div>
	);
};

export default ServerCard;
