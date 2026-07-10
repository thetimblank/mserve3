/**
 * Activity insights derived from the 7-day telemetry history: when players are
 * most active (peak-hours histogram), the busiest server, and its player trend.
 * Everything here is computed by {@link useDashboardActivity}.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';

import type { Server } from '@/data/servers';
import { METRIC_COLORS } from '@/pages/server/stats/stats-utils';
import { Skeleton } from '@/components/ui/skeleton';

import DashboardSection from './dashboard-section';
import type { DashboardActivity, PlayerTrend } from './use-dashboard-activity';

type Props = { servers: Server[]; activity: DashboardActivity };

const formatHour = (hour: number) => {
	const period = hour < 12 ? 'am' : 'pm';
	const display = hour % 12 === 0 ? 12 : hour % 12;
	return `${display}${period}`;
};

const TREND_META: Record<PlayerTrend, { icon: React.ElementType; label: string; className: string }> = {
	up: { icon: TrendingUp, label: 'Trending up', className: 'text-emerald-500' },
	down: { icon: TrendingDown, label: 'Trending down', className: 'text-amber-500' },
	flat: { icon: Minus, label: 'Steady', className: 'text-muted-foreground' },
};

const ActivityInsights: React.FC<Props> = ({ servers, activity }) => {
	const histogram = activity.hourHistogram;
	const maxBar = Math.max(1, ...histogram);
	const hasActivity = histogram.some((value) => value > 0);

	const busiest = activity.ranked[0];
	const busiestServer = busiest ? servers.find((server) => server.id === busiest.serverId) : undefined;

	if (activity.isLoading) {
		return (
			<DashboardSection
				className='h-full'
				title='Activity insights'
				description='Player patterns over the last 7 days.'>
				<Skeleton className='h-28 w-full' />
			</DashboardSection>
		);
	}

	return (
		<DashboardSection
			className='h-full'
			title='Activity insights'
			description='Player patterns over the last 7 days. Sleeping windows read as offline.'>
			{!hasActivity ? (
				<p className='text-sm text-muted-foreground'>
					Not enough player history yet — check back after some sessions.
				</p>
			) : (
				<div className='space-y-4'>
					<div>
						<div className='mb-1 flex items-center justify-between text-xs text-muted-foreground'>
							<span>Busiest hours (local time)</span>
							{activity.peakHour != null && (
								<span>
									Peak around <span className='font-medium'>{formatHour(activity.peakHour)}</span>
								</span>
							)}
						</div>
						<div className='flex h-24 items-end gap-0.5'>
							{histogram.map((value, hour) => (
								<div
									key={hour}
									title={`${formatHour(hour)}: ${value} player-samples`}
									className='flex-1 rounded-t-sm transition-all'
									style={{
										height: `${Math.max((value / maxBar) * 100, 2)}%`,
										background:
											hour === activity.peakHour ? METRIC_COLORS.players : 'var(--muted-foreground)',
										opacity: hour === activity.peakHour ? 1 : 0.35,
									}}
								/>
							))}
						</div>
						<div className='mt-1 flex justify-between text-[10px] text-muted-foreground'>
							<span>12am</span>
							<span>6am</span>
							<span>12pm</span>
							<span>6pm</span>
							<span>11pm</span>
						</div>
					</div>

					{busiest && busiestServer && (
						<div className='flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-sm'>
							<div className='min-w-0'>
								<p className='text-xs text-muted-foreground'>Busiest server</p>
								<Link
									to={`/servers/${encodeURIComponent(busiestServer.id)}`}
									className='truncate font-medium hover:underline'>
									{busiestServer.name}
								</Link>
							</div>
							<div className='flex items-center gap-4 text-right'>
								<div>
									<p className='text-xs text-muted-foreground'>Peak players</p>
									<p className='font-semibold tabular-nums'>{busiest.peakPlayers}</p>
								</div>
								<div>
									<p className='text-xs text-muted-foreground'>Uptime</p>
									<p className='font-semibold tabular-nums'>
										{Math.round(busiest.availability * 100)}%
									</p>
								</div>
								{(() => {
									const meta = TREND_META[busiest.trend];
									const Icon = meta.icon;
									return (
										<span className={`flex items-center gap-1 text-xs ${meta.className}`}>
											<Icon className='size-4' />
											{meta.label}
										</span>
									);
								})()}
							</div>
						</div>
					)}
				</div>
			)}
		</DashboardSection>
	);
};

export default ActivityInsights;
