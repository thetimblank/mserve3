/**
 * "Most used" bento panel: ranks servers by recent activity (player load +
 * availability over the last 7 days, see {@link useDashboardActivity}) and shows
 * a player-trend sparkline plus an availability bar for each. Links to detail.
 */
import React from 'react';
import { m } from 'motion/react';
import { Link } from 'react-router-dom';
import { BarChart3, TrendingUp } from 'lucide-react';

import type { Server } from '@/data/servers';
import { Card } from '@/components/ui/card';
import { METRIC_COLORS } from '@/pages/server/stats/stats-utils';
import TelemetrySparkline from '@/pages/server/stats/telemetry-sparkline';

import type { DashboardActivity } from './use-dashboard-activity';

type Props = {
	servers: Server[];
	activity: DashboardActivity;
	limit?: number;
};

const MostUsedServers: React.FC<Props> = ({ servers, activity, limit = 5 }) => {
	const serversById = React.useMemo(
		() => new Map(servers.map((server) => [server.id, server])),
		[servers],
	);
	const ranked = activity.ranked.slice(0, limit);

	return (
		<section className='flex flex-col gap-3'>
			<h2 className='text-sm font-semibold tracking-wide text-muted-foreground uppercase'>Most used</h2>
			<Card className='flex-1 gap-0 divide-y divide-border p-0'>
				{ranked.length === 0 ? (
					<div className='flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground'>
						<BarChart3 className='size-8' />
						<p className='text-sm'>Usage trends appear here once servers start collecting telemetry.</p>
					</div>
				) : (
					ranked.map((entry, index) => {
						const server = serversById.get(entry.serverId);
						if (!server) return null;
						const availabilityPct = Math.round(entry.availability * 100);
						return (
							<m.div
								key={entry.serverId}
								initial={{ x: -8, opacity: 0 }}
								animate={{ x: 0, opacity: 1 }}
								transition={{ duration: 0.3, delay: index * 0.05 }}>
								<Link
									to={`/servers/${encodeURIComponent(server.id)}`}
									className='flex items-center gap-4 p-4 transition-colors hover:bg-accent/30'>
									<span className='w-5 shrink-0 text-center text-lg font-bold text-muted-foreground tabular-nums'>
										{index + 1}
									</span>
									<div className='min-w-0 flex-1'>
										<div className='flex items-center justify-between gap-2'>
											<h3 className='truncate font-semibold'>{server.name}</h3>
											<span className='flex shrink-0 items-center gap-1 text-xs text-muted-foreground'>
												<TrendingUp className='size-3.5' />
												{entry.avgPlayers >= 0.05 ? entry.avgPlayers.toFixed(1) : '0'} avg ·{' '}
												{entry.peakPlayers} peak
											</span>
										</div>
										<div className='mt-2 flex items-center gap-3'>
											<div className='h-1.5 flex-1 overflow-hidden rounded-full bg-muted'>
												<div
													className='h-full rounded-full'
													style={{
														width: `${availabilityPct}%`,
														backgroundColor: METRIC_COLORS.online,
													}}
												/>
											</div>
											<span className='w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums'>
												{availabilityPct}% up
											</span>
										</div>
									</div>
									<div className='hidden h-10 w-24 shrink-0 sm:block'>
										<TelemetrySparkline
											data={entry.chart}
											dataKey='playersOnline'
											color={METRIC_COLORS.players}
											domain={[0, 'auto']}
											className='h-full w-full'
										/>
									</div>
								</Link>
							</m.div>
						);
					})
				)}
			</Card>
		</section>
	);
};

export default MostUsedServers;
