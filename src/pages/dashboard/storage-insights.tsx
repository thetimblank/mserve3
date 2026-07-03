/**
 * Storage breakdown: the largest servers by disk footprint with a worlds-vs-
 * backups split, plus "backup bloat" callouts where backups dominate a server's
 * footprint. Sizes come from the batched `get_servers_storage` command.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { HardDrive, TriangleAlert } from 'lucide-react';

import type { Server } from '@/data/servers';
import { formatBytes } from '@/pages/server/server-utils';
import { METRIC_COLORS } from '@/pages/server/stats/stats-utils';
import { Skeleton } from '@/components/ui/skeleton';

import DashboardSection from './dashboard-section';
import type { DashboardStorage } from './use-dashboard-storage';

type Props = { servers: Server[]; storage: DashboardStorage };

const StorageInsights: React.FC<Props> = ({ servers, storage }) => {
	const rows = React.useMemo(() => {
		return servers
			.map((server) => ({
				server,
				info: storage.byDirectory.get(server.directory) ?? {
					directory: server.directory,
					totalBytes: 0,
					worldsBytes: 0,
					backupsBytes: 0,
				},
			}))
			.filter((row) => row.info.totalBytes > 0)
			.sort((a, b) => b.info.totalBytes - a.info.totalBytes)
			.slice(0, 6);
	}, [servers, storage.byDirectory]);

	const maxTotal = rows[0]?.info.totalBytes ?? 0;

	// Backups eating more than half a server's footprint = worth surfacing.
	const bloat = rows.filter(
		(row) => row.info.backupsBytes > row.info.totalBytes * 0.5 && row.info.backupsBytes > 0,
	);

	if (storage.isLoading && rows.length === 0) {
		return (
			<DashboardSection title='Storage breakdown' description='Disk footprint per server.'>
				<div className='space-y-3'>
					<Skeleton className='h-6 w-full' />
					<Skeleton className='h-6 w-4/5' />
					<Skeleton className='h-6 w-3/5' />
				</div>
			</DashboardSection>
		);
	}

	return (
		<DashboardSection
			title='Storage breakdown'
			description={`${formatBytes(storage.totalBytes)} across all servers · worlds vs backups`}>
			{rows.length === 0 ? (
				<p className='text-sm text-muted-foreground'>No server files measured yet.</p>
			) : (
				<div className='space-y-3'>
					{rows.map(({ server, info }) => {
						const width = maxTotal > 0 ? (info.totalBytes / maxTotal) * 100 : 0;
						const worldsPct = info.totalBytes > 0 ? (info.worldsBytes / info.totalBytes) * 100 : 0;
						const backupsPct =
							info.totalBytes > 0 ? (info.backupsBytes / info.totalBytes) * 100 : 0;
						return (
							<Link
								key={server.id}
								to={`/servers/${encodeURIComponent(server.id)}`}
								className='block space-y-1 rounded-md p-1 transition-colors hover:bg-accent/50'>
								<div className='flex items-center justify-between gap-2 text-sm'>
									<span className='truncate font-medium'>{server.name}</span>
									<span className='shrink-0 tabular-nums text-muted-foreground'>
										{formatBytes(info.totalBytes)}
									</span>
								</div>
								<div
									className='flex h-2 overflow-hidden rounded-full bg-muted'
									style={{ width: `${Math.max(width, 6)}%` }}>
									<div style={{ width: `${worldsPct}%`, background: METRIC_COLORS.players }} />
									<div style={{ width: `${backupsPct}%`, background: METRIC_COLORS.ram }} />
								</div>
							</Link>
						);
					})}
					<div className='flex items-center gap-4 pt-1 text-xs text-muted-foreground'>
						<span className='flex items-center gap-1.5'>
							<span className='size-2 rounded-full' style={{ background: METRIC_COLORS.players }} />
							Worlds
						</span>
						<span className='flex items-center gap-1.5'>
							<span className='size-2 rounded-full' style={{ background: METRIC_COLORS.ram }} />
							Backups
						</span>
						<span className='flex items-center gap-1.5'>
							<HardDrive className='size-3' /> Other
						</span>
					</div>
				</div>
			)}

			{bloat.length > 0 && (
				<div className='mt-4 space-y-1.5 border-t border-border/60 pt-3'>
					{bloat.map(({ server, info }) => (
						<Link
							key={server.id}
							to={`/servers/${encodeURIComponent(server.id)}/backups`}
							className='flex items-center gap-2 text-xs text-amber-500 hover:underline'>
							<TriangleAlert className='size-3.5 shrink-0' />
							<span>
								{server.name}: backups are {formatBytes(info.backupsBytes)} of{' '}
								{formatBytes(info.totalBytes)} — review retention.
							</span>
						</Link>
					))}
				</div>
			)}
		</DashboardSection>
	);
};

export default StorageInsights;
