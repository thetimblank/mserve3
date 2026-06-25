/**
 * "Online now" bento panel: a tile per running server with its live status ring,
 * player count, version and uptime. Each tile links straight to the server's
 * detail page. Hidden entirely when nothing is running.
 */
import React from 'react';
import { m } from 'motion/react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Clock, Package, ServerOff, Users } from 'lucide-react';

import type { Server } from '@/data/servers';
import { Card } from '@/components/ui/card';
import ServerStatus from '@/components/server-status';
import { getPrimaryMinecraftVersion } from '@/lib/utils';
import { formatUptime } from '@/pages/server/server-utils';

type Props = {
	servers: Server[];
};

const OnlineServerTile: React.FC<{ server: Server; delay: number }> = ({ server, delay }) => {
	const version = server.stats.server_version ?? server.provider.minecraft_version ?? null;
	const uptime = server.stats.uptime ? formatUptime(server.stats.uptime) : null;

	return (
		<m.div
			initial={{ scale: 0.96, opacity: 0 }}
			animate={{ scale: 1, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.35, bounce: 0, delay }}>
			<Link to={`/servers/${encodeURIComponent(server.id)}`} className='group block'>
				<Card className='flex-row items-center gap-4 p-4 transition-colors group-hover:border-primary/50 group-hover:bg-accent/30'>
					<ServerStatus server={server} size='md' />
					<div className='min-w-0 flex-1'>
						<div className='flex items-center gap-1.5'>
							<h3 className='truncate text-lg font-bold'>{server.name}</h3>
							<ArrowUpRight className='size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100' />
						</div>
						<div className='mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground'>
							<span className='flex items-center gap-1.5'>
								<Users className='size-4' />
								{server.stats.players_online ?? 0}/{server.stats.players_max ?? 0}
							</span>
							{version && (
								<span className='flex items-center gap-1.5'>
									<Package className='size-4' />
									{getPrimaryMinecraftVersion(version) ?? version}
								</span>
							)}
							{uptime && (
								<span className='flex items-center gap-1.5'>
									<Clock className='size-4' />
									{uptime}
								</span>
							)}
						</div>
					</div>
				</Card>
			</Link>
		</m.div>
	);
};

const OnlineServers: React.FC<Props> = ({ servers }) => {
	const online = servers.filter((server) => server.status === 'online' || server.status === 'starting');

	return (
		<section className='flex flex-col gap-3'>
			<h2 className='text-sm font-semibold tracking-wide text-muted-foreground uppercase'>
				Online now {online.length > 0 && <span className='text-foreground'>({online.length})</span>}
			</h2>
			{online.length === 0 ? (
				<Card className='flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground'>
					<ServerOff className='size-8' />
					<p className='text-sm'>No servers are running right now.</p>
				</Card>
			) : (
				<div className='grid gap-3 sm:grid-cols-2'>
					{online.map((server, index) => (
						<OnlineServerTile key={server.id} server={server} delay={index * 0.04} />
					))}
				</div>
			)}
		</section>
	);
};

export default OnlineServers;
