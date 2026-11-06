/**
 * The Servers cluster: a title card with the server count, then one quick-action
 * tile per server. The cluster moves and hides as one unit; the tiles inside are
 * not individually sortable.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';

import type { Server } from '@/data/servers';
import { Button } from '@/components/ui/button';

import ClusterTitleCard from './cluster-title-card';
import ServerTile from './server-tile';

type Props = { servers: Server[] };

const isRunning = (server: Server) => server.status === 'online' || server.status === 'starting';

const ServersCluster: React.FC<Props> = ({ servers }) => {
	// Running first, then everything else, each group alphabetical, so the
	// cluster leads with what's live without hiding anything.
	const ordered = React.useMemo(() => {
		const rank = (server: Server) => (isRunning(server) ? 0 : 1);
		return [...servers].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
	}, [servers]);

	const onlineCount = servers.filter((server) => server.status === 'online').length;

	return (
		<>
			<ClusterTitleCard
				title='Servers'
				value={servers.length}
				hint={`${onlineCount} online`}
				action={
					<Button asChild size='sm' variant='secondary'>
						<Link to='/servers/new'>
							<Plus />
							New server
						</Link>
					</Button>
				}
			/>
			{ordered.map((server, index) => (
				<ServerTile key={server.id} server={server} delay={0.03 + index * 0.03} />
			))}
		</>
	);
};

export default ServersCluster;
