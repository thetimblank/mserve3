/**
 * "Networks" bento row: a shortcut card per managed network showing its online
 * member count and proxy bind port. Clicking opens the Network page focused on
 * that network (via router state). Hidden when no networks exist.
 */
import React from 'react';
import { m } from 'motion/react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Network as NetworkIcon, Plus } from 'lucide-react';

import type { Server } from '@/data/servers';
import { Card } from '@/components/ui/card';
import { getNetworkServerIds, type ManagedNetwork } from '@/lib/network-schema';

type Props = {
	networks: ManagedNetwork[];
	servers: Server[];
};

const DashboardNetworks: React.FC<Props> = ({ networks, servers }) => {
	const onlineIds = React.useMemo(
		() => new Set(servers.filter((server) => server.status === 'online').map((server) => server.id)),
		[servers],
	);

	return (
		<section className='flex flex-col gap-3'>
			<div className='flex items-center justify-between'>
				<h2 className='text-sm font-semibold tracking-wide text-muted-foreground uppercase'>
					Server networks
				</h2>
				<Link
					to='/network'
					className='flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground'>
					Manage <ArrowUpRight className='size-3.5' />
				</Link>
			</div>
			{networks.length === 0 ? (
				<Link to='/network' className='group block'>
					<Card className='flex-row items-center gap-3 border-dashed p-5 text-muted-foreground transition-colors group-hover:border-primary/50 group-hover:text-foreground'>
						<Plus className='size-5' />
						<p className='text-sm'>Create a network to group servers behind a proxy.</p>
					</Card>
				</Link>
			) : (
				<div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
					{networks.map((network, index) => {
						const ids = getNetworkServerIds(network);
						const onlineCount = ids.filter((id) => onlineIds.has(id)).length;
						const allOnline = ids.length > 0 && onlineCount === ids.length;
						return (
							<m.div
								key={network.id}
								initial={{ scale: 0.96, opacity: 0 }}
								animate={{ scale: 1, opacity: 1 }}
								transition={{ type: 'spring', duration: 0.35, bounce: 0, delay: index * 0.04 }}>
								<Link
									to='/network'
									state={{ networkId: network.id }}
									className='group block'>
									<Card className='gap-3 p-5 transition-colors group-hover:border-primary/50 group-hover:bg-accent/30'>
										<div className='flex items-center gap-2'>
											<NetworkIcon className='size-5 text-primary' />
											<h3 className='truncate font-bold'>{network.name}</h3>
											<ArrowUpRight className='ml-auto size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100' />
										</div>
										<div className='flex items-center gap-2 text-sm text-muted-foreground'>
											<span
												className={
													allOnline
														? 'inline-block size-2 rounded-full bg-green-500'
														: onlineCount > 0
															? 'inline-block size-2 rounded-full bg-yellow-500'
															: 'inline-block size-2 rounded-full bg-muted-foreground/40'
												}
											/>
											{onlineCount}/{ids.length} online · port {network.basePort}
										</div>
									</Card>
								</Link>
							</m.div>
						);
					})}
				</div>
			)}
		</section>
	);
};

export default DashboardNetworks;
