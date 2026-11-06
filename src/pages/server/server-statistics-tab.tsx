/**
 * Dedicated per-server Statistics page: timeline graphs of CPU, RAM, players,
 * TPS and online availability, pulled from the SQLite telemetry history via
 * {@link useServerTelemetryHistory}. Range is user-selectable.
 */
import React from 'react';
import { Activity, Cpu, MemoryStick, Power, Users } from 'lucide-react';

import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import type { Server } from '@/data/servers';
import { useExperience } from '@/data/user';
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';

import TelemetryAreaChart from './stats/telemetry-area-chart';
import { useServerTelemetryHistory } from './stats/use-server-telemetry-history';
import { resolveHeapGb } from '@/lib/ram-utils';
import {
	DEFAULT_TIME_RANGE,
	METRIC_COLORS,
	TIME_RANGES,
	availabilityChartConfig,
	cpuChartConfig,
	formatBytes,
	formatRamUsage,
	getTimeRange,
	latestReading,
	maxPointsForRange,
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

type RamUnit = 'pct' | 'bytes';

const RAM_UNIT_OPTIONS: SegmentedControlOption<RamUnit>[] = [
	{ value: 'pct', label: 'RAM %' },
	{ value: 'bytes', label: 'RAM MB' },
];

const TIME_RANGE_OPTIONS: SegmentedControlOption<TimeRangeKey>[] = TIME_RANGES.map((range) => ({
	value: range.key,
	label: range.label,
}));

const pctTick = (value: number) => `${Math.round(value)}%`;
const countTick = (value: number) => String(Math.round(value));
const tpsTick = (value: number) => value.toFixed(1);
const availabilityTick = (value: number) =>
	value >= 1 ? 'Online' : value >= 0.5 ? 'Sleeping' : 'Offline';

/** Latest non-null reading of a metric, formatted for the card badge. */
const latestBadge = (
	data: ChartPoint[],
	key: keyof ChartPoint,
	format: (value: number) => string,
): string | undefined => {
	const value = latestReading(data, key);
	return value == null ? undefined : format(value);
};

const ServerStatisticsTab: React.FC<Props> = ({ server }) => {
	const [rangeKey, setRangeKey] = React.useState<TimeRangeKey>(DEFAULT_TIME_RANGE);
	const [ramUnit, setRamUnit] = React.useState<RamUnit>('pct');

	const range = getTimeRange(rangeKey);
	const { supportsTpsCommand } = getServerProviderCapabilities(server.provider);
	const showRamBytes = useExperience().atLeast('standard');

	const { points, isLoading, updatedAt } = useServerTelemetryHistory(server.id, range.ms, {
		maxPoints: maxPointsForRange(range.ms),
	});
	const data = React.useMemo(() => toChartData(points), [points]);

	const ramBadge = React.useMemo(() => {
		if (showRamBytes) {
			const pct = latestBadge(data, 'ramUsed', pctTick);
			if (!pct) return undefined;
			const ramBytes = latestReading(data, 'ramBytes');
			return ramBytes == null ? pct : `${pct} ${formatRamUsage(ramBytes, resolveHeapGb(server))}`;
		}
		return ramUnit === 'pct'
			? latestBadge(data, 'ramUsed', pctTick)
			: latestBadge(data, 'ramBytes', formatBytes);
	}, [showRamBytes, data, ramUnit, server]);

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
					<SegmentedControl
						size='sm'
						aria-label='RAM unit'
						value={ramUnit}
						onValueChange={setRamUnit}
						options={RAM_UNIT_OPTIONS}
					/>
				</div>
				<SegmentedControl
					size='sm'
					aria-label='Time range'
					value={rangeKey}
					onValueChange={setRangeKey}
					options={TIME_RANGE_OPTIONS}
				/>
			</div>

			{/* Charts */}
			<div className='grid gap-4 xl:grid-cols-2'>
				<TelemetryAreaChart
					className='xl:col-span-2'
					title='Availability'
					icon={<Power className='size-4' />}
					config={availabilityChartConfig}
					data={data}
					dataKey='availability'
					color={METRIC_COLORS.online}
					rangeMs={range.ms}
					valueFormatter={availabilityTick}
					yDomain={[0, 1]}
					yTicks={[0, 0.5, 1]}
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
					badge={ramBadge}
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

				{supportsTpsCommand && (
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
