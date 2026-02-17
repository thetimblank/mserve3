import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Server } from '@/data/servers';
import {
	ArrowDownToLine,
	Boxes,
	CircleCheck,
	Clock,
	Folder,
	MemoryStick,
	OctagonX,
	RefreshCcw,
	Users,
} from 'lucide-react';
import React from 'react';
import { m } from 'motion/react';
import { Link } from 'react-router-dom';
import ServerStatus from './server-status';

interface Props {
	server: Server;
	delay?: number;
}

const ServerCard: React.FC<Props> = ({ server, delay }) => {
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
							<div className='flex items-center lg:text-lg gap-1'>
								<Users className='size-4' />
								{server.stats.players}/{server.stats.capacity}
							</div>
						)}
						{server.version && (
							<div className='flex items-center lg:text-lg gap-1'>
								<ArrowDownToLine className='size-4' />
								{server.version}
							</div>
						)}
						{server.ram && (
							<div className='flex items-center lg:text-lg gap-1'>
								<MemoryStick className='size-4' />
								{server.ram}GB
							</div>
						)}
						<div className='flex items-center lg:text-lg gap-1'>
							<Boxes className='size-4' />
							{server.file}
						</div>
						{server.status === 'online' && (
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
						{/* TODO: implement */}
						{server.status === 'online' && (
							<Button variant='secondary'>
								{/* TODO: implement */}
								<OctagonX />
								<p>Stop</p>
							</Button>
						)}
						{server.status === 'online' && (
							<Button variant='secondary'>
								{/* TODO: implement */}
								<RefreshCcw />
								<p>Restart</p>
							</Button>
						)}
						{server.status === 'offline' && (
							<Button variant='secondary'>
								{/* TODO: implement */}
								<CircleCheck />
								<p>Start</p>
							</Button>
						)}
						<Button variant='secondary'>
							{/* TODO: implement */}
							<Folder />
							<p>Open Folder</p>
						</Button>
					</div>
				</CardContent>
			</Card>
		</m.div>
	);
};

export default ServerCard;
