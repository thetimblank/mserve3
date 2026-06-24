/**
 * Dedicated per-server Statistics page: timeline graphs of CPU, RAM, players,
 * TPS and online availability, pulled from the SQLite telemetry history via
 * {@link useServerTelemetryHistory}. Range is user-selectable.
 */
import React from 'react';
import { Activity, Cpu, MemoryStick, Power, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import type { Server } from '@/data/servers';
import { isProxyProvider } from '@/lib/server-provider';
import { cn } from '@/lib/utils';

import TelemetryAreaChart from './stats/telemetry-area-chart';
import { useServerTelemetryHistory } from './stats/use-server-telemetry-history';
import {
	DEFAULT_TIME_RANGE,
	METRIC_COLORS,
	TIME_RANGES,
	cpuChartConfig,
	formatBytes,
	getTimeRange,
	maxPointsForRange,
	onlineChartConfig,
	playersChartConfig,
	ramBytesChartConfig,
	ramPctChartConfig,
	toChartData,
	tpsChartConfig,
	type ChartPoint,
	type TimeRangeKey,
} from './stats/stats-utils';

type Props = {
	server: Server;
};

const pctTick = (value: number) => `${Math.round(value)}%`;
const countTick = (value: number) => String(Math.round(value));
const tpsTick = (value: number) => value.toFixed(1);
const onlineTick = (value: number) => (value >= 0.5 ? 'Online' : 'Offline');

/** Latest non-null reading of a metric, formatted for the card badge. */
const latestBadge = (
	data: ChartPoint[],
	key: keyof ChartPoint,
	format: (value: number) => string,
): string | undefined => {
	for (let index = data.length - 1; index >= 0; index -= 1) {
		const value = data[index][key];
		if (value != null) return format(Number(value));
	}
	return undefined;
};

const ServerStatisticsTab: React.FC<Props> = ({ server }) => {
	const [rangeKey, setRangeKey] = React.useState<TimeRangeKey>(DEFAULT_TIME_RANGE);
	const [ramUnit, setRamUnit] = React.useState<'pct' | 'bytes'>('pct');

	const range = getTimeRange(rangeKey);
	const isProxy = isProxyProvider(server.provider);

	const { points, isLoading, updatedAt } = useServerTelemetryHistory(server.id, range.ms, {
		maxPoints: maxPointsForRange(range.ms),
	});
	const data = React.useMemo(() => toChartData(points), [points]);

	return (
		<div className='h-[calc(100vh-200px)] overflow-y-auto app-scroll-area app-scroll-stable pb-4'>
			{/* Controls */}
			<div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
				<div className='flex items-center gap-3 text-sm text-muted-foreground'>
					<span>
						{isLoading && points.length === 0
							? 'Loading…'
							: updatedAt
								? `Updated ${new Date(updatedAt).toLocaleTimeString()}`
								: 'No data yet'}
					</span>
					<ButtonGroup>
						<Button
							size='sm'
							variant={ramUnit === 'pct' ? 'default' : 'outline'}
							className={cn(ramUnit === 'pct' && 'cursor-default')}
							onClick={() => setRamUnit('pct')}>
							RAM %
						</Button>
						<Button
							size='sm'
							variant={ramUnit === 'bytes' ? 'default' : 'outline'}
							className={cn(ramUnit === 'bytes' && 'cursor-default')}
							onClick={() => setRamUnit('bytes')}>
							RAM MB
						</Button>
					</ButtonGroup>
				</div>
				<ButtonGroup>
					{TIME_RANGES.map((option) => (
						<Button
							key={option.key}
							size='sm'
							variant={option.key === rangeKey ? 'default' : 'outline'}
							className={cn(option.key === rangeKey && 'cursor-default')}
							onClick={() => setRangeKey(option.key)}>
							{option.label}
						</Button>
					))}
				</ButtonGroup>
			</div>

			{/* Charts */}
			<div className='grid gap-4 xl:grid-cols-2'>
				<TelemetryAreaChart
					className='xl:col-span-2'
					title='Availability'
					icon={<Power className='size-4' />}
					config={onlineChartConfig}
					data={data}
					dataKey='online'
					color={METRIC_COLORS.online}
					rangeMs={range.ms}
					valueFormatter={onlineTick}
					yDomain={[0, 1]}
					yTicks={[0, 1]}
					stepped
				/>

				<TelemetryAreaChart
					title='CPU usage'
					icon={<Cpu className='size-4' />}
					badge={latestBadge(data, 'cpuUsed', pctTick)}
					config={cpuChartConfig}
					data={data}
					dataKey='cpuUsed'
					color={METRIC_COLORS.cpu}
					rangeMs={range.ms}
					valueFormatter={pctTick}
					yDomain={[0, 100]}
				/>

				<TelemetryAreaChart
					title='Memory usage'
					icon={<MemoryStick className='size-4' />}
					badge={
						ramUnit === 'pct'
							? latestBadge(data, 'ramUsed', pctTick)
							: latestBadge(data, 'ramBytes', formatBytes)
					}
					config={ramUnit === 'pct' ? ramPctChartConfig : ramBytesChartConfig}
					data={data}
					dataKey={ramUnit === 'pct' ? 'ramUsed' : 'ramBytes'}
					color={METRIC_COLORS.ram}
					rangeMs={range.ms}
					valueFormatter={ramUnit === 'pct' ? pctTick : formatBytes}
					yDomain={ramUnit === 'pct' ? [0, 100] : ['auto', 'auto']}
				/>

				<TelemetryAreaChart
					title='Players online'
					icon={<Users className='size-4' />}
					badge={latestBadge(data, 'playersOnline', countTick)}
					config={playersChartConfig}
					data={data}
					dataKey='playersOnline'
					color={METRIC_COLORS.players}
					rangeMs={range.ms}
					valueFormatter={countTick}
					yDomain={[0, 'auto']}
					stepped
				/>

				{!isProxy && (
					<TelemetryAreaChart
						title='TPS'
						icon={<Activity className='size-4' />}
						badge={latestBadge(data, 'tps', tpsTick)}
						config={tpsChartConfig}
						data={data}
						dataKey='tps'
						color={METRIC_COLORS.tps}
						rangeMs={range.ms}
						valueFormatter={tpsTick}
						yDomain={[0, 20]}
					/>
				)}
			</div>
		</div>
	);
};

export default ServerStatisticsTab;
