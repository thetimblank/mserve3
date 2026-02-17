import { Server } from '@/data/servers';
import { LoaderCircle, X } from 'lucide-react';
import React from 'react';

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
			tpsLabel: 'text-xs',
			status: 'text-base',
		},
		lg: {
			container: 'gap-2',
			visual: 'size-20',
			ring: 'size-20 border-[5px]',
			icon: 'size-12',
			tps: 'max-w-20 max-h-20 text-lg',
			tpsLabel: 'text-sm',
			status: 'text-lg',
		},
		xl: {
			container: 'gap-2',
			visual: 'size-24',
			ring: 'size-24 border-6',
			icon: 'size-14',
			tps: 'max-w-24 max-h-24 text-xl',
			tpsLabel: 'text-base',
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
				<div className={`text-green-600 flex items-center flex-col ${classes.container}`}>
					<div className={`${classes.visual} flex flex-col items-center justify-center`}>
						<div className={`absolute border-green-600 rounded-full ${classes.ring}`} />
						<p className={`${classes.tps} overflow-hidden font-bold`}>
							{server.stats.tps.toPrecision(3)}
						</p>
						<p className={`leading-1 text-muted-foreground/60 ${classes.tpsLabel}`}>TPS</p>
					</div>
					<p className={`font-bold ${classes.status}`}>Online</p>
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
