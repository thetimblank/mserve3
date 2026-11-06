/**
 * The Storage cluster: a title card with the total footprint, a donut of what
 * uses the space (worlds, backups, everything else), and stacked Backups and
 * Worlds stats. Sizes come from the batched `get_servers_storage` command.
 */
import React from 'react';
import { Archive, Globe } from 'lucide-react';

import type { Server } from '@/data/servers';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes, pluralize as plural } from '@/lib/utils';
import { METRIC_COLORS } from '@/pages/server/stats/stats-utils';

import BentoItem from './bento-item';
import { BENTO_STACK_CLASSES, BENTO_WIDE_ITEM_CLASSES } from './bento-shapes';
import ClusterTitleCard from './cluster-title-card';
import StatCard from './stat-card';
import type { DashboardStorage } from './use-dashboard-storage';

type Props = { servers: Server[]; storage: DashboardStorage };

type Segment = { label: string; bytes: number; color: string };

/** SVG donut: a circle with circumference 100, so dash lengths are percentages. */
const StorageDonut: React.FC<{ segments: Segment[]; total: number }> = ({ segments, total }) => {
	let offset = 0;
	return (
		<svg viewBox='0 0 42 42' className='size-28 shrink-0 -rotate-90' aria-hidden>
			<circle cx='21' cy='21' r='15.915' fill='none' stroke='var(--muted)' strokeWidth='6' />
			{total > 0 &&
				segments.map((segment) => {
					const pct = (segment.bytes / total) * 100;
					const dash = (
						<circle
							key={segment.label}
							cx='21'
							cy='21'
							r='15.915'
							fill='none'
							stroke={segment.color}
							strokeWidth='6'
							strokeDasharray={`${pct} ${100 - pct}`}
							strokeDashoffset={-offset}
						/>
					);
					offset += pct;
					return pct > 0 ? dash : null;
				})}
		</svg>
	);
};

/** `12.3 GB` with the unit set smaller, so the big title number fits narrow cells. */
const SizeValue: React.FC<{ bytes: number }> = ({ bytes }) => {
	const [amount, unit] = formatBytes(bytes).split(' ');
	return (
		<>
			{amount}
			{unit && <span className='ml-1 text-[0.5em]'>{unit}</span>}
		</>
	);
};

const StorageCluster: React.FC<Props> = ({ servers, storage }) => {
	const loading = storage.isLoading && storage.totalBytes === 0;
	const total = storage.totalBytes;
	const segments: Segment[] = [
		{ label: 'Worlds', bytes: storage.worldsBytes, color: METRIC_COLORS.players },
		{ label: 'Backups', bytes: storage.backupsBytes, color: METRIC_COLORS.ram },
		{
			label: 'Everything else',
			bytes: Math.max(0, total - storage.worldsBytes - storage.backupsBytes),
			color: 'var(--muted-foreground)',
		},
	];

	const backupCount = servers.reduce((sum, server) => sum + server.backups.length, 0);
	const worldCount = servers.reduce((sum, server) => sum + server.worlds.length, 0);
	const sizeOrDash = (bytes: number) => (loading ? '–' : formatBytes(bytes));

	return (
		<>
			<ClusterTitleCard
				title='Storage'
				value={loading ? '–' : <SizeValue bytes={total} />}
				hint={`across ${plural(servers.length, 'server')}`}
			/>

			<BentoItem delay={0.03} className={BENTO_WIDE_ITEM_CLASSES}>
				<Card className='h-full flex-row items-center gap-6 p-5'>
					{loading ? (
						<Skeleton className='size-28 shrink-0 rounded-full' />
					) : (
						<StorageDonut segments={segments} total={total} />
					)}
					<div className='min-w-0 flex-1 space-y-2.5'>
						<p className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
							What uses the space
						</p>
						{segments.map((segment) => (
							<div key={segment.label} className='flex items-center gap-2 text-sm'>
								<span className='size-2.5 shrink-0 rounded-full' style={{ background: segment.color }} />
								<span className='min-w-0 flex-1 truncate'>{segment.label}</span>
								<span className='shrink-0 tabular-nums text-muted-foreground'>
									{sizeOrDash(segment.bytes)}
									{!loading && total > 0 && (
										<span className='ml-1.5 inline-block w-9 text-right text-xs'>
											{Math.round((segment.bytes / total) * 100)}%
										</span>
									)}
								</span>
							</div>
						))}
					</div>
				</Card>
			</BentoItem>

			<div className={BENTO_STACK_CLASSES}>
				<StatCard
					compact
					icon={<Archive />}
					label='Backups'
					value={sizeOrDash(storage.backupsBytes)}
					hint={plural(backupCount, 'backup')}
					color={METRIC_COLORS.ram}
					delay={0.06}
				/>
				<StatCard
					compact
					icon={<Globe />}
					label='Worlds'
					value={sizeOrDash(storage.worldsBytes)}
					hint={plural(worldCount, 'world')}
					color={METRIC_COLORS.players}
					delay={0.09}
				/>
			</div>
		</>
	);
};

export default StorageCluster;
