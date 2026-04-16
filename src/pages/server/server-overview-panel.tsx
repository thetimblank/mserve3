import React from 'react';
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
import { Button } from '@/components/ui/button';
import OpenFolderButton from '@/components/open-folder-button';
import ServerStatus from '@/components/server-status';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Server } from '@/data/servers';
import { getPrimaryMinecraftVersion } from '@/lib/utils';
import { formatUptime } from './server-utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import ServerContentTabs from './server-content-tabs';
import type { ServerContentTab } from './server-types';

type Props = {
	server: Server;
	isBusy: boolean;
	onStart: () => void;
	onStop: () => void;
	onRestart: () => void;
	activeTab: ServerContentTab;
	onTabChange: (tab: ServerContentTab) => void;
};

const ServerOverviewPanel: React.FC<Props> = ({
	server,
	isBusy,
	onStart,
	onStop,
	onRestart,
	activeTab,
	onTabChange,
}) => {
	return (
		<Card className='mb-6'>
			<CardHeader className='border-b border-b-border'>
				<div className='flex gap-10'>
					<ServerStatus server={server} size='xl' />
					<div className='flex flex-col'>
						<div className='flex gap-2 mb-2 flex-wrap'>
							{server.status === 'online' && (
								<Button onClick={onStop} disabled={isBusy}>
									<OctagonX />
									<p>Stop</p>
								</Button>
							)}
							{server.status === 'online' && (
								<Button variant='secondary' onClick={onRestart} disabled={isBusy}>
									<RefreshCcw />
									<p>Restart</p>
								</Button>
							)}
							{server.status === 'offline' && (
								<Button onClick={onStart} disabled={isBusy}>
									<CircleCheck />
									<p>Serve</p>
								</Button>
							)}
							<OpenFolderButton directory={server.directory} disabled={isBusy} />
						</div>
						<div className='flex items-center gap-2'>
							{server.createdAt && (
								<div className='flex items-center gap-2'>
									<Clock className='size-4' />
									<p>
										Server was created
										<span className='font-bold'>
											{' '}
											{new Date(server.createdAt).toLocaleDateString()}
										</span>
										.
									</p>
								</div>
							)}
							{server.createdAt && server.status !== 'offline' && (
								<p className='text-sm text-muted-foreground'>•</p>
							)}
							{server.status !== 'offline' && (
								<p className='text-sm text-muted-foreground'>
									Note: Some features may be unavailable when the server is online
								</p>
							)}
						</div>
						{server.status === 'online' && (
							<div className='flex items-center gap-2'>
								<Users className='size-4' />
								Players: {server.stats.players}/{server.stats.capacity}
							</div>
						)}
						{server.auto_restart && (
							<div className='flex items-center gap-2'>
								<RefreshCcw className='size-4' />
								<p>
									Server automatically <span className='font-bold'>restarts on shutdown</span>.
								</p>
							</div>
						)}
						{server.version && (
							<div className='flex items-center gap-2'>
								<ArrowDownToLine className='size-4' />
								{(() => {
									const primary = getPrimaryMinecraftVersion(server.version);
									if (!primary) return <span>{server.version}</span>;
									return (
										<Tooltip>
											<TooltipTrigger asChild>
												<span>
													Server version is <span className='font-bold'>{primary}</span>.
												</span>
											</TooltipTrigger>
											<TooltipContent className='max-w-40 text-wrap text-white dark:text-black'>
												{server.version}
											</TooltipContent>
										</Tooltip>
									);
								})()}
							</div>
						)}
						{server.ram && (
							<div className='flex items-center gap-2'>
								<MemoryStick className='size-4' />
								<p>
									Server has <span className='font-bold'>{server.ram}GB</span> of memory.
								</p>
							</div>
						)}
						<div className='flex items-center gap-2'>
							<Boxes className='size-4' />
							<p>
								Server jar file is <span className='font-bold'>{server.file}</span>.
							</p>
						</div>
						{server.status === 'online' && server.stats.uptime && (
							<div className='flex items-center gap-2'>
								<Clock className='size-4' />
								Uptime: {formatUptime(server.stats.uptime)}
							</div>
						)}
					</div>
				</div>
			</CardHeader>
			<CardContent className='flex gap-2'>
				<ServerContentTabs activeTab={activeTab} onTabChange={onTabChange} />
			</CardContent>
		</Card>
	);
};

export default React.memo(ServerOverviewPanel);
