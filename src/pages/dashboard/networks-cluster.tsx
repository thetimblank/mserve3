/**
 * The Networks cluster: a title card with the network count, then one shortcut
 * card per managed network (online members and proxy port). A card opens the
 * Network page focused on that network (via router state). With no networks it
 * shows a create card instead.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Network as NetworkIcon, Plus } from 'lucide-react';

import type { Server } from '@/data/servers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getNetworkServerIds, type ManagedNetwork } from '@/lib/network-schema';
import { cn } from '@/lib/utils';

import BentoItem from './bento-item';
import ClusterTitleCard from './cluster-title-card';

type Props = {
	networks: ManagedNetwork[];
	servers: Server[];
};

const NetworksCluster: React.FC<Props> = ({ networks, servers }) => {
	const onlineIds = React.useMemo(
		() => new Set(servers.filter((server) => server.status === 'online').map((server) => server.id)),
		[servers],
	);

	const rows = networks.map((network) => {
		const ids = getNetworkServerIds(network);
		const onlineCount = ids.filter((id) => onlineIds.has(id)).length;
		return { network, total: ids.length, onlineCount };
	});
	const fullyOnline = rows.filter((row) => row.total > 0 && row.onlineCount === row.total).length;

	return (
		<>
			<ClusterTitleCard
				title='Networks'
				value={networks.length}
				hint={networks.length > 0 ? `${fullyOnline} fully online` : 'Group servers behind a proxy'}
				action={
					networks.length > 0 && (
						<Button asChild size='sm' variant='secondary'>
							<Link to='/network'>
								Manage
								<ArrowUpRight />
							</Link>
						</Button>
					)
				}
			/>

			{rows.length === 0 ? (
				<BentoItem delay={0.03}>
					<Link to='/network' className='group block h-full'>
						<Card className='h-full justify-center gap-3 p-5 text-muted-foreground transition-colors group-hover:bg-accent/30 group-hover:text-foreground'>
							<Plus className='size-5' />
							<p className='text-sm'>Create a network to group servers behind a proxy.</p>
						</Card>
					</Link>
				</BentoItem>
			) : (
				rows.map(({ network, total, onlineCount }, index) => {
					const allOnline = total > 0 && onlineCount === total;
					return (
						<BentoItem key={network.id} delay={0.03 + index * 0.03}>
							<Link to='/network' state={{ networkId: network.id }} className='group block h-full'>
								<Card className='h-full justify-between gap-3 p-5 transition-colors group-hover:border-primary/50 group-hover:bg-accent/30'>
									<div className='flex items-center gap-2'>
										<NetworkIcon className='size-5 shrink-0 text-primary' />
										<h3 className='truncate font-bold'>{network.name}</h3>
										<ArrowUpRight className='ml-auto size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100' />
									</div>
									<div className='flex items-center gap-2 text-sm text-muted-foreground'>
										<span
											className={cn(
												'inline-block size-2 shrink-0 rounded-full',
												allOnline
													? 'bg-green-500'
													: onlineCount > 0
														? 'bg-yellow-500'
														: 'bg-muted-foreground/40',
											)}
										/>
										{onlineCount}/{total} online · port {network.basePort}
									</div>
								</Card>
							</Link>
						</BentoItem>
					);
				})
			)}
		</>
	);
};

export default NetworksCluster;
