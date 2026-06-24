/**
 * Shared presets, formatters and chart configs for the server telemetry charts
 * (overview sparklines + the Statistics page). Chart colors map to the global
 * `--chart-1..5` tokens defined in index.css so they follow light/dark theme.
 */
import type { ChartConfig } from '@/components/ui/chart';
import type { TelemetryHistoryPoint } from '@/pages/server/server-types';
import { formatBytes } from '../server-utils';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type TimeRangeKey = '15m' | '1h' | '6h' | '24h' | '7d' | '30d';

export type TimeRange = {
	key: TimeRangeKey;
	label: string;
	ms: number;
};

export const TIME_RANGES: TimeRange[] = [
	{ key: '15m', label: '15m', ms: 15 * MINUTE },
	{ key: '1h', label: '1h', ms: HOUR },
	{ key: '6h', label: '6h', ms: 6 * HOUR },
	{ key: '24h', label: '24h', ms: DAY },
	{ key: '7d', label: '7d', ms: 7 * DAY },
	{ key: '30d', label: '30d', ms: 30 * DAY },
];

export const DEFAULT_TIME_RANGE: TimeRangeKey = '1h';

export const getTimeRange = (key: TimeRangeKey): TimeRange =>
	TIME_RANGES.find((range) => range.key === key) ?? TIME_RANGES[1];

/** Target point count for a given range — denser for short windows. */
export const maxPointsForRange = (rangeMs: number): number => {
	if (rangeMs <= HOUR) return 120;
	if (rangeMs <= DAY) return 180;
	return 240;
};

/** Formats an x-axis tick: clock time for short ranges, date for long ones. */
export const formatAxisTime = (ts: number, rangeMs: number): string => {
	const date = new Date(ts);
	if (rangeMs <= DAY) {
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}
	return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** Full timestamp label used in chart tooltips. */
export const formatTooltipTime = (ts: number): string => new Date(ts).toLocaleString();

export const formatPercent = (value: number | null | undefined): string =>
	value == null ? '—' : `${value.toFixed(value < 10 ? 2 : 1)}%`;

export { formatBytes };

/** Maps raw history points into the shape Recharts consumes for area charts. */
export type ChartPoint = {
	timestamp: number;
	online: number;
	playersOnline: number | null;
	tps: number | null;
	ramBytes: number | null;
	ramUsed: number | null;
	cpuUsed: number | null;
};

export const toChartData = (points: TelemetryHistoryPoint[]): ChartPoint[] =>
	points.map((point) => ({
		timestamp: point.timestamp,
		online: point.online ? 1 : 0,
		playersOnline: point.playersOnline,
		tps: point.tps,
		ramBytes: point.ramBytes,
		ramUsed: point.ramUsed,
		cpuUsed: point.cpuUsed,
	}));

// One color token per metric. Kept stable across overview + stats page.
export const METRIC_COLORS = {
	cpu: 'var(--chart-1)',
	ram: 'var(--chart-2)',
	players: 'var(--chart-3)',
	tps: 'var(--chart-4)',
	online: 'var(--chart-5)',
} as const;

export const cpuChartConfig: ChartConfig = { cpuUsed: { label: 'CPU', color: METRIC_COLORS.cpu } };
export const ramPctChartConfig: ChartConfig = { ramUsed: { label: 'RAM', color: METRIC_COLORS.ram } };
export const ramBytesChartConfig: ChartConfig = { ramBytes: { label: 'RAM', color: METRIC_COLORS.ram } };
export const playersChartConfig: ChartConfig = {
	playersOnline: { label: 'Players', color: METRIC_COLORS.players },
};
export const tpsChartConfig: ChartConfig = { tps: { label: 'TPS', color: METRIC_COLORS.tps } };
export const onlineChartConfig: ChartConfig = { online: { label: 'Online', color: METRIC_COLORS.online } };
