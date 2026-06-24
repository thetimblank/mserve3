import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Server, useServers } from '@/data/servers';
import {
	ArrowDownToLine,
	CircleCheck,
	Clock,
	MemoryStick,
	OctagonX,
	Package,
	RefreshCcw,
	Users,
} from 'lucide-react';
import React from 'react';
import { m } from 'motion/react';
import { Link } from 'react-router-dom';
import ServerStatus from './server-status';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import OpenFolderButton from '@/components/open-folder-button';
import { formatUptime, getPrimaryMinecraftVersion } from '@/lib/utils';
import {
	forceKillServer,
	restartServer,
	startServer,
	stopServer,
	type ServerControlContext,
} from '@/lib/server-controls';
import { useUser } from '@/data/user';

interface Props {
	server: Server;
	delay?: number;
}

const ServerCard: React.FC<Props> = ({ server, delay }) => {
	const { setServerStatus, updateServerStats } = useServers();
	const { user } = useUser();
	const [isBusy, setIsBusy] = React.useState(false);
	const displayVersion = server.stats.server_version ?? server.provider.minecraft_version ?? null;

	const controlContext = (): ServerControlContext => ({
		server,
		javaInstallation: user.java_installation_default,
		setServerStatus,
		updateServerStats,
	});

	const runControl = async (action: (context: ServerControlContext) => Promise<boolean>) => {
		if (isBusy) return;
		setIsBusy(true);
		try {
			await action(controlContext());
		} finally {
			setIsBusy(false);
		}
	};

	const handleStart = () => void runControl(startServer);
	const handleStop = () => void runControl(stopServer);
	const handleRestart = () => void runControl(restartServer);
	const handleForceKill = () => void runControl(forceKillServer);

	return (
		<m.div
			initial={{ scale: 0.9, opacity: 0 }}
			whileInView={{ scale: 1, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.3, bounce: 0, delay: delay }}>
			<Card className='overflow-hidden'>
				<CardHeader className='border-b-2 border-b-border'>
					<CardTitle className='text-3xl'>{server.name}</CardTitle>
					<CardDescription className='flex gap-6'>
						{server.status === 'online' && (
							<Tooltip>
								<TooltipTrigger>
									<div className='flex items-center lg:text-lg gap-2'>
										<Users className='size-5' />
										{server.stats.players_online ?? 0}/{server.stats.players_max ?? 0}
									</div>
								</TooltipTrigger>
								<TooltipContent>
									<p className='font-bold'>Players Online out of Player Capacity</p>
								</TooltipContent>
							</Tooltip>
						)}
						{displayVersion && (
							<Tooltip>
								<TooltipTrigger>
									<div className='flex items-center lg:text-lg gap-2'>
										<ArrowDownToLine className='size-5' />
										{getPrimaryMinecraftVersion(displayVersion) ?? displayVersion}
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
									<Package className='size-5' />
									{server.provider.name}
								</div>
							</TooltipTrigger>
							<TooltipContent>
								<p className='font-bold'>Server Provider</p>
							</TooltipContent>
						</Tooltip>
						{server.status === 'online' && server.stats.uptime && (
							<Tooltip>
								<TooltipTrigger>
									<div className='flex items-center lg:text-lg gap-1'>
										<Clock className='size-4' />
										{formatUptime(server.stats.uptime)}
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
						<Link to={`/servers/${encodeURIComponent(server.id)}`}>
							<Button>View More Details</Button>
						</Link>
						{server.status !== 'offline' && (
							<Button variant='destructive-secondary' onClick={handleForceKill} disabled={isBusy}>
								<OctagonX />
								<p>Force Kill</p>
							</Button>
						)}
						{(server.status === 'online' || server.status === 'starting') && (
							<Button variant='secondary' onClick={handleStop} disabled={isBusy}>
								<OctagonX />
								<p>Stop</p>
							</Button>
						)}
						{(server.status === 'online' || server.status === 'starting') && (
							<Button variant='secondary' onClick={handleRestart} disabled={isBusy}>
								<RefreshCcw />
								<p>Restart</p>
							</Button>
						)}
						{server.status === 'offline' && (
							<Button variant='secondary' onClick={handleStart} disabled={isBusy}>
								<CircleCheck />
								<p>Serve</p>
							</Button>
						)}
						<OpenFolderButton directory={server.directory} disabled={isBusy} />
					</div>
				</CardContent>
			</Card>
		</m.div>
	);
};

export default ServerCard;
