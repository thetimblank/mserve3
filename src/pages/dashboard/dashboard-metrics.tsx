/**
 * The dashboard's headline bento row — live, at-a-glance health across every
 * server: how many are running, how many players are connected, how much memory
 * the running servers reserve, and how often servers have dropped offline over
 * the last 7 days (a stand-in for crashes/instability).
 */
import React from 'react';
import { AlertTriangle, HardDrive, MemoryStick, Server as ServerIcon, Users } from 'lucide-react';

import type { Server } from '@/data/servers';
import { METRIC_COLORS } from '@/pages/server/stats/stats-utils';
import { formatBytes } from '@/pages/server/server-utils';

import StatCard from './stat-card';
import type { DashboardActivity } from './use-dashboard-activity';
import type { DashboardStorage } from './use-dashboard-storage';

type Props = {
	servers: Server[];
	activity: DashboardActivity;
	storage: DashboardStorage;
	/** Optional trailing tile rendered in the same grid (the Edit Layout tile). */
	trailing?: React.ReactNode;
};

const DashboardMetrics: React.FC<Props> = ({ servers, activity, storage, trailing }) => {
	const summary = React.useMemo(() => {
		const online = servers.filter((server) => server.status === 'online');
		const playersOnline = online.reduce((sum, server) => sum + (server.stats.players_online ?? 0), 0);
		const playersMax = online.reduce((sum, server) => sum + (server.stats.players_max ?? 0), 0);
		const ramAllocatedTotal = servers.reduce((sum, server) => sum + (server.ram ?? 0), 0);
		const ramAllocatedOnline = online.reduce((sum, server) => sum + (server.ram ?? 0), 0);
		const crashedCount = servers.filter((server) => server.status === 'crashed').length;
		return {
			onlineCount: online.length,
			offlineCount: servers.length - online.length,
			playersOnline,
			playersMax,
			ramAllocatedTotal,
			ramAllocatedOnline,
			crashedCount,
		};
	}, [servers]);

	// Largest server by total footprint, for the storage card hint.
	const largest = React.useMemo(() => {
		let best: { name: string; bytes: number } | null = null;
		for (const server of servers) {
			const bytes = storage.byDirectory.get(server.directory)?.totalBytes ?? 0;
			if (!best || bytes > best.bytes) best = { name: server.name, bytes };
		}
		return best;
	}, [servers, storage.byDirectory]);

	const downtimeHint =
		summary.crashedCount > 0
			? `${summary.crashedCount} crashed now · last 7 days`
			: 'offline drops · last 7 days';

	return (
		<div className='grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6'>
			<StatCard
				icon={<ServerIcon />}
				label='Servers online'
				value={`${summary.onlineCount}/${servers.length}`}
				hint={summary.offlineCount > 0 ? `${summary.offlineCount} not running` : 'All servers running'}
				color={METRIC_COLORS.online}
				delay={0.02}
			/>
			<StatCard
				icon={<Users />}
				label='Players online'
				value={summary.playersOnline}
				hint={summary.playersMax > 0 ? `of ${summary.playersMax} capacity` : 'No active sessions'}
				color={METRIC_COLORS.players}
				delay={0.06}
			/>
			<StatCard
				icon={<MemoryStick />}
				label='Memory in use'
				value={`${summary.ramAllocatedOnline} GB`}
				hint={`of ${summary.ramAllocatedTotal} GB allocated`}
				color={METRIC_COLORS.ram}
				delay={0.1}
			/>
			<StatCard
				icon={<HardDrive />}
				label='Storage used'
				value={storage.isLoading && storage.totalBytes === 0 ? '—' : formatBytes(storage.totalBytes)}
				hint={largest && largest.bytes > 0 ? `${largest.name} is largest` : 'across all servers'}
				color={METRIC_COLORS.tps}
				delay={0.14}
			/>
			<StatCard
				icon={<AlertTriangle />}
				label='Downtime events'
				value={activity.isLoading ? '—' : activity.totalInterruptions}
				hint={downtimeHint}
				color={METRIC_COLORS.cpu}
				delay={0.18}
			/>
			{trailing}
		</div>
	);
};

export default DashboardMetrics;
