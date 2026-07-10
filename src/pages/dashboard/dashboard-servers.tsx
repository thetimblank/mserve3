/**
 * The Servers bento block: every server as a compact quick-action tile. This is
 * one draggable/hideable unit — the whole block moves as a group; the tiles inside
 * are not individually sortable. Replaces the old "Online now" card, which only
 * showed running servers.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';

import type { Server } from '@/data/servers';
import { Button } from '@/components/ui/button';

import DashboardSection from './dashboard-section';
import ServerTile from './server-tile';

type Props = { servers: Server[] };

const DashboardServers: React.FC<Props> = ({ servers }) => {
	// Running first, then everything else, each group alphabetical — so the block
	// leads with what's live without hiding anything.
	const ordered = React.useMemo(() => {
		const rank = (server: Server) =>
			server.status === 'online' || server.status === 'starting' ? 0 : 1;
		return [...servers].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
	}, [servers]);

	return (
		<DashboardSection
			className='h-full'
			title={
				<span className='flex items-center gap-2'>
					Servers
					<span className='text-sm font-normal text-muted-foreground'>({servers.length})</span>
				</span>
			}
			action={
				<Button asChild size='sm' variant='secondary'>
					<Link to='/servers/new'>
						<Plus />
						New
					</Link>
				</Button>
			}>
			<div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
				{ordered.map((server, index) => (
					<ServerTile key={server.id} server={server} delay={index * 0.03} />
				))}
			</div>
		</DashboardSection>
	);
};

export default DashboardServers;
