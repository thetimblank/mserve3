import { Server } from '@/data/servers';
import { LoaderCircle, X } from 'lucide-react';
import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import clsx from 'clsx';

interface Props {
	server: Server;
	size?: 'md' | 'lg' | 'xl';
}

const ServerStatus: React.FC<Props> = ({ server, size = 'md' }) => {
	const sizeClasses = {
		md: {
			container: 'gap-1',
			visual: 'size-16',
			ring: 'size-16 border-4',
			icon: 'size-10',
			tps: 'max-w-16 max-h-16 text-base',
			status: 'text-base',
		},
		lg: {
			container: 'gap-2',
			visual: 'size-20',
			ring: 'size-20 border-[5px]',
			icon: 'size-12',
			tps: 'max-w-20 max-h-20 text-lg',
			status: 'text-lg',
		},
		xl: {
			container: 'gap-2',
			visual: 'size-24',
			ring: 'size-24 border-6',
			icon: 'size-14',
			tps: 'max-w-24 max-h-24 text-xl',
			status: 'text-xl',
		},
	} as const;

	const classes = sizeClasses[size];

	return (
		<>
			{server.status === 'offline' && (
				<div className={`text-red-400 flex items-center flex-col ${classes.container}`}>
					<div className={`${classes.visual} flex flex-col items-center justify-center`}>
						<div className={`absolute border-red-400 rounded-full ${classes.ring}`} />
						<X className={classes.icon} />
					</div>
					<p className={`font-bold ${classes.status}`}>Offline</p>
				</div>
			)}
			{server.status === 'online' && (
				<div className={`text-green-500 flex items-center flex-col ${classes.container}`}>
					<Tooltip>
						<TooltipTrigger>
							<div className={`${classes.visual} flex items-center justify-center`}>
								<div
									className={clsx(
										'absolute rounded-full border-green-500',
										classes.ring,
										server.stats.tps > 19 && 'border-green-500',
										server.stats.tps > 18 && 'border-green-600',
										server.stats.tps > 17 && 'border-yellow-500',
										server.stats.tps > 15 && 'border-orange-500',
										server.stats.tps > 10 && 'border-red-400',
										server.stats.tps <= 5 && 'border-red-800',
									)}
								/>
								<p
									className={clsx(
										'overflow-hidden font-bold',
										classes.tps,
										server.stats.tps > 19 && 'text-green-500',
										server.stats.tps > 18 && 'text-green-600',
										server.stats.tps > 17 && 'text-yellow-500',
										server.stats.tps > 15 && 'text-orange-500',
										server.stats.tps > 10 && 'text-red-400',
										server.stats.tps <= 5 && 'text-red-800',
									)}>
									{server.stats.tps.toPrecision(3)}
								</p>
							</div>
							<p className={`font-bold ${classes.status}`}>Online</p>
						</TooltipTrigger>
						<TooltipContent>
							<p className='font-bold'>Server TPS (Ticks per second)</p>
						</TooltipContent>
					</Tooltip>
				</div>
			)}
			{server.status === 'starting' && (
				<div className={`text-yellow-500 flex items-center flex-col ${classes.container}`}>
					<LoaderCircle className={`animate-spin ${classes.visual}`} />
					<p className={`font-bold ${classes.status}`}>Starting</p>
				</div>
			)}
			{server.status === 'closing' && (
				<div className={`text-yellow-500 flex items-center flex-col ${classes.container}`}>
					<LoaderCircle className={`animate-spin ${classes.visual}`} />
					<p className={`font-bold ${classes.status}`}>Closing</p>
				</div>
			)}
		</>
	);
};

export default ServerStatus;
