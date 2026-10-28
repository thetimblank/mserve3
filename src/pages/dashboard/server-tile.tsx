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
	type ServerStatus,
	startActionLabel,
	stopActionLabel,
	useServers,
} from '@/data/servers';
import { useServerJavaResolver } from '@/data/java-download';
import { startServer, stopServer, type ServerControlContext } from '@/lib/server-controls';
import { getPrimaryMinecraftVersion } from '@/lib/utils';

const STATUS_META: Record<ServerStatus, { dot: string; label: string }> = {
	online: { dot: 'bg-green-500', label: 'Online' },
	offline: { dot: 'bg-muted-foreground/40', label: 'Offline' },
	starting: { dot: 'bg-yellow-500 animate-pulse', label: 'Starting' },
	closing: { dot: 'bg-yellow-500 animate-pulse', label: 'Stopping' },
	crashed: { dot: 'bg-red-500', label: 'Crashed' },
	sleeping: { dot: 'bg-indigo-400', label: 'Sleeping' },
};

type Props = { server: Server; delay?: number };

const ServerTile: React.FC<Props> = ({ server, delay = 0 }) => {
	const { setServerStatus, updateServerStats } = useServers();
	const resolveServerJava = useServerJavaResolver();
	const [isBusy, setIsBusy] = React.useState(false);

	const detailPath = `/servers/${encodeURIComponent(server.id)}`;
	const version = server.stats.server_version ?? server.provider.minecraft_version ?? null;
	const meta = STATUS_META[server.status];
	const running = server.status === 'online' || server.status === 'starting';

	const controlContext = (javaExecutable?: string): ServerControlContext => ({
		server,
		javaExecutable,
		setServerStatus,
		updateServerStats,
	});

	const runControl = async (action: (context: ServerControlContext) => Promise<boolean>) => {
		if (isBusy) return;
		setIsBusy(true);
		try {
			await action(controlContext());
		} finally {
			setIsBusy(false);
		}
	};

	// Start/wake needs a resolved Java runtime (and may prompt to download one).
	const runStartControl = async (action: (context: ServerControlContext) => Promise<boolean>) => {
		if (isBusy) return;
		setIsBusy(true);
		try {
			const javaExecutable = await resolveServerJava(server);
			if (!javaExecutable) return;
			await action(controlContext(javaExecutable));
		} finally {
			setIsBusy(false);
		}
	};

	const handleStart = () => void runStartControl(startServer);
	const handleStop = () => void runControl(stopServer);

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
