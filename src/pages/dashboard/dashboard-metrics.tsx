/**
 * The dashboard's headline bento row — live, at-a-glance health across every
 * server: how many are running, how many players are connected, how much memory
 * the running servers reserve, and how often servers have dropped offline over
 * the last 7 days (a stand-in for crashes/instability).
 */
import React from 'react';
import { AlertTriangle, MemoryStick, Server as ServerIcon, Users } from 'lucide-react';

import type { Server } from '@/data/servers';
import { METRIC_COLORS } from '@/pages/server/stats/stats-utils';

import StatCard from './stat-card';
import type { DashboardActivity } from './use-dashboard-activity';

type Props = {
	servers: Server[];
	activity: DashboardActivity;
};

const DashboardMetrics: React.FC<Props> = ({ servers, activity }) => {
	const summary = React.useMemo(() => {
		const online = servers.filter((server) => server.status === 'online');
		const playersOnline = online.reduce((sum, server) => sum + (server.stats.players_online ?? 0), 0);
		const playersMax = online.reduce((sum, server) => sum + (server.stats.players_max ?? 0), 0);
		const ramAllocatedTotal = servers.reduce((sum, server) => sum + (server.ram ?? 0), 0);
		const ramAllocatedOnline = online.reduce((sum, server) => sum + (server.ram ?? 0), 0);
		return {
			onlineCount: online.length,
			offlineCount: servers.length - online.length,
			playersOnline,
			playersMax,
			ramAllocatedTotal,
			ramAllocatedOnline,
		};
	}, [servers]);

	return (
		<div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
			<StatCard
				icon={<ServerIcon />}
				label='Servers online'
				value={`${summary.onlineCount}/${servers.length}`}
				hint={summary.offlineCount > 0 ? `${summary.offlineCount} offline` : 'All servers running'}
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
				icon={<AlertTriangle />}
				label='Downtime events'
				value={activity.isLoading ? '—' : activity.totalInterruptions}
				hint='offline drops · last 7 days'
				color={METRIC_COLORS.cpu}
				delay={0.14}
			/>
		</div>
	);
};

export default DashboardMetrics;
