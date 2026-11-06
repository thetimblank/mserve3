/**
 * The Activity cluster, from the 7-day telemetry history: a title card with the
 * busiest hour, a wide players-by-hour chart, and stacked Peak players and
 * Uptime stats. Everything here is computed by {@link useDashboardActivity}.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Minus, Timer, TrendingDown, TrendingUp, Users } from 'lucide-react';

import type { Server } from '@/data/servers';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { METRIC_COLORS } from '@/pages/server/stats/stats-utils';

import BentoItem from './bento-item';
import { BENTO_STACK_CLASSES, BENTO_WIDE_ITEM_CLASSES } from './bento-shapes';
import ClusterTitleCard from './cluster-title-card';
import StatCard from './stat-card';
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

const ActivityCluster: React.FC<Props> = ({ servers, activity }) => {
	const histogram = activity.hourHistogram;
	const maxBar = Math.max(1, ...histogram);
	const hasActivity = histogram.some((value) => value > 0);

	// The single busiest server by peak players, and mean uptime across servers
	// that have any history.
	const { peak, uptime } = React.useMemo(() => {
		const withData = Array.from(activity.byServer.values()).filter((entry) => entry.hasData);
		const best = withData.reduce<(typeof withData)[number] | null>(
			(top, entry) => (entry.peakPlayers > (top?.peakPlayers ?? 0) ? entry : top),
			null,
		);
		const meanUptime =
			withData.length > 0
				? withData.reduce((sum, entry) => sum + entry.availability, 0) / withData.length
				: null;
		return { peak: best, uptime: meanUptime };
	}, [activity.byServer]);

	// `peak` is only set when some server had players, so it gates the whole card.
	const peakServer = peak ? servers.find((server) => server.id === peak.serverId) : undefined;
	const trend = peak ? TREND_META[peak.trend] : null;
	const loading = activity.isLoading;

	return (
		<>
			<ClusterTitleCard
				title='Activity'
				value={!loading && activity.peakHour != null ? formatHour(activity.peakHour) : '–'}
				hint={
					loading ? 'Busiest hour' : hasActivity ? 'Busiest hour, last 7 days' : 'Not enough player history yet'
				}
			/>

			<BentoItem delay={0.03} className={BENTO_WIDE_ITEM_CLASSES}>
				<Card className='h-full justify-between gap-2 p-5'>
					<div className='flex items-center justify-between text-xs text-muted-foreground'>
						<span className='font-medium tracking-wide uppercase'>Players by hour</span>
						<span>Local time</span>
					</div>
					{loading ? (
						<Skeleton className='h-28 w-full' />
					) : !hasActivity ? (
						<p className='flex h-28 items-center text-sm text-muted-foreground'>
							Check back after some play sessions. Sleeping windows count as offline.
						</p>
					) : (
						<>
							<div className='flex h-28 items-end gap-0.5'>
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
							<div className='flex justify-between text-[10px] text-muted-foreground'>
								<span>12am</span>
								<span>6am</span>
								<span>12pm</span>
								<span>6pm</span>
								<span>11pm</span>
							</div>
						</>
					)}
				</Card>
			</BentoItem>

			<div className={BENTO_STACK_CLASSES}>
				<StatCard
					compact
					icon={<Users />}
					label='Peak players'
					value={
						peak && trend ? (
							<span className='flex items-center gap-2'>
								{peak.peakPlayers}
								<trend.icon className={`size-5 ${trend.className}`} aria-label={trend.label} />
							</span>
						) : (
							'–'
						)
					}
					hint={
						peakServer ? (
							<Link to={`/servers/${encodeURIComponent(peakServer.id)}`} className='hover:underline'>
								on {peakServer.name}
							</Link>
						) : (
							'last 7 days'
						)
					}
					color={METRIC_COLORS.players}
					delay={0.06}
				/>
				<StatCard
					compact
					icon={<Timer />}
					label='Uptime'
					value={!loading && uptime != null ? `${Math.round(uptime * 100)}%` : '–'}
					hint='average, last 7 days'
					color={METRIC_COLORS.online}
					delay={0.09}
				/>
			</div>
		</>
	);
};

export default ActivityCluster;
