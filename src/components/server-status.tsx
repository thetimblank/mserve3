import { Server } from '@/data/servers';
import { Circle, LoaderCircle } from 'lucide-react';
import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import clsx from 'clsx';
import { useServers } from '@/data/servers';

interface Props {
	server: Server;
	size?: 'md' | 'lg' | 'xl';
}

const ServerStatus: React.FC<Props> = ({ server, size = 'md' }) => {
	const { setServerStatus } = useServers();

	const handlePromoteToOnline = React.useCallback(() => {
		if (server.status !== 'starting') return;
		setServerStatus(server.id, 'online');
	}, [server.id, server.status, setServerStatus]);

	const handleStartingKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			handlePromoteToOnline();
		},
		[handlePromoteToOnline],
	);

	const sizeClasses = {
		md: {
			container: 'gap-1 relative',
			visual: 'size-16',
			ring: 'size-16',
			icon: 'size-10',
			tps: 'max-w-16 max-h-16 text-base',
			status: 'text-base',
		},
		lg: {
			container: 'gap-2 relative',
			visual: 'size-20',
			ring: 'size-20',
			icon: 'size-12',
			tps: 'max-w-20 max-h-20 text-lg',
			status: 'text-lg',
		},
		xl: {
			container: 'gap-2 relative',
			visual: 'size-24',
			ring: 'size-24',
			icon: 'size-14',
			tps: 'max-w-24 max-h-24 text-xl',
			status: 'text-xl',
		},
	} as const;

	const classes = sizeClasses[size];
	const tps = typeof server.stats.tps === 'number' ? server.stats.tps : null;
	const hasTps = tps !== null && Number.isFinite(tps) && tps > 0;
	const numericTps = tps ?? 0;

	return (
		<>
			{server.status === 'offline' && (
				<div className={`text-red-400 flex items-center flex-col ${classes.container}`}>
					<div className={`${classes.visual} flex flex-col items-center justify-center`}>
						<Circle className={`absolute text-red-400 ${classes.ring}`} />
					</div>
					<p className={`font-bold ${classes.status}`}>Offline</p>
				</div>
			)}
			{server.status === 'online' && (
				<div className={`text-green-500 flex items-center flex-col ${classes.container}`}>
					<Tooltip>
						<TooltipTrigger>
							<div className={`${classes.visual} flex items-center justify-center`}>
								<Circle
									className={clsx(
										'absolute',
										classes.ring,
										hasTps && numericTps <= 10 && 'text-red-800',
										hasTps && numericTps > 10 && numericTps <= 15 && 'text-red-400',
										hasTps && numericTps > 15 && numericTps <= 17 && 'text-orange-500',
										hasTps && numericTps > 17 && numericTps <= 18 && 'text-yellow-500',
										hasTps && numericTps > 18 && numericTps <= 19 && 'text-green-600',
										(!hasTps || (numericTps > 19 && numericTps <= 20)) && 'text-green-500',
									)}
								/>
								{hasTps && (
									<p
										className={clsx(
											'overflow-hidden font-bold',
											classes.tps,
											numericTps <= 10 && 'text-red-800',
											numericTps > 10 && numericTps <= 15 && 'text-red-400',
											numericTps > 15 && numericTps <= 17 && 'text-orange-500',
											numericTps > 17 && numericTps <= 18 && 'text-yellow-500',
											numericTps > 18 && numericTps <= 19 && 'text-green-600',
											numericTps > 19 && numericTps <= 20 && 'text-green-500',
										)}>
										{numericTps.toPrecision(3)}
									</p>
								)}
							</div>
							<p className={`font-bold ${classes.status}`}>Online</p>
						</TooltipTrigger>
						{hasTps && (
							<TooltipContent>
								<p className='font-bold'>Server TPS (Ticks per second)</p>
							</TooltipContent>
						)}
					</Tooltip>
				</div>
			)}
			{server.status === 'starting' && (
				<div
					className={clsx(
						`text-yellow-500 flex items-center flex-col animate-pulse ${classes.container}`,
						'cursor-pointer',
					)}
					onClick={handlePromoteToOnline}
					onKeyDown={handleStartingKeyDown}
					role='button'
					tabIndex={0}
					title='Click to mark server online'>
					<LoaderCircle className={`animate-spin ${classes.visual}`} />
					<p className={`font-bold ${classes.status}`}>Starting</p>
				</div>
			)}
			{server.status === 'closing' && (
				<div className={`text-yellow-500 flex items-center flex-col animate-pulse ${classes.container}`}>
					<LoaderCircle className={`animate-spin ${classes.visual}`} />
					<p className={`font-bold ${classes.status}`}>Closing</p>
				</div>
			)}
		</>
	);
};

export default ServerStatus;
