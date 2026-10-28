/**
 * Compact per-server tile for the dashboard's Servers block. Shows a status dot,
 * name (links to detail), a couple of at-a-glance chips, and the one or two quick
 * actions that matter for the server's current state (Serve / Stop / Awake, plus
 * Open). Start/restart resolve a Java runtime first, exactly like the full
 * `server-card.tsx`; the app-wide runtime monitor owns authoritative status, so
 * these actions only fire optimistic updates.
 */
import React from 'react';
import { m } from 'motion/react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleCheck, MemoryStick, Moon, OctagonX, Package, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
	canStartStatus,
	canStopStatus,
	type Server,
	SERVER_STATUS_META,
	startActionLabel,
	stopActionLabel,
} from '@/data/servers';
import { useServerControls } from '@/hooks/use-server-controls';
import { getPrimaryMinecraftVersion } from '@/lib/utils';

type Props = { server: Server; delay?: number };

const ServerTile: React.FC<Props> = ({ server, delay = 0 }) => {
	const { isBusy, start: handleStart, stop: handleStop } = useServerControls(server);

	const detailPath = `/servers/${encodeURIComponent(server.id)}`;
	const version = server.stats.server_version ?? server.provider.minecraft_version ?? null;
	const meta = SERVER_STATUS_META[server.status];
	const running = server.status === 'online' || server.status === 'starting';


	return (
		<m.div
			initial={{ scale: 0.96, opacity: 0 }}
			animate={{ scale: 1, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.35, bounce: 0, delay }}
			className='h-full'>
			<Card className='group flex h-full flex-col justify-between gap-0 p-4 transition-colors hover:border-primary/50'>
				<div className='flex items-start justify-between gap-2'>
					<Link to={detailPath} className='flex min-w-0 items-center gap-2.5'>
						<span className={`size-2.5 shrink-0 rounded-full ${meta.dot}`} />
						<span className='min-w-0'>
							<span className='block truncate font-semibold leading-tight group-hover:underline'>
								{server.name}
							</span>
							<span className='block text-xs text-muted-foreground'>{meta.label}</span>
						</span>
					</Link>
					<Link to={detailPath} aria-label='Open server'>
						<ArrowUpRight className='size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100' />
					</Link>
				</div>

				<div className='mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'>
					{running && (
						<span className='flex items-center gap-1'>
							<Users className='size-3.5' />
							{server.stats.players_online ?? 0}/{server.stats.players_max ?? 0}
						</span>
					)}
					{version && (
						<span className='flex items-center gap-1'>
							<Package className='size-3.5' />
							{getPrimaryMinecraftVersion(version) ?? version}
						</span>
					)}
					{server.ram ? (
						<span className='flex items-center gap-1'>
							<MemoryStick className='size-3.5' />
							{server.ram}GB
						</span>
					) : null}
				</div>

				<div className='mt-3 flex items-center gap-2'>
					{canStartStatus(server.status) && (
						<Button size='sm' onClick={handleStart} disabled={isBusy}>
							{server.status === 'sleeping' ? <Moon /> : <CircleCheck />}
							{startActionLabel(server.status)}
						</Button>
					)}
					{canStopStatus(server.status) && (
						<Button size='sm' variant='secondary' onClick={handleStop} disabled={isBusy}>
							<OctagonX />
							{stopActionLabel(server.status)}
						</Button>
					)}
					<Button asChild size='sm' variant='secondary'>
						<Link to={detailPath}>Open</Link>
					</Button>
				</div>
			</Card>
		</m.div>
	);
};

export default ServerTile;
