/**
 * Aggregates recent telemetry history across every server for the dashboard's
 * "most used" ranking and the global activity metrics. For each server we pull a
 * bucket-averaged 7-day window from the SQLite store (the same
 * `get_server_telemetry_history` command the Statistics page uses) and derive:
 *
 *   - availability   fraction of buckets the server was reachable
 *   - avgPlayers     mean player count while it had readings
 *   - peakPlayers    busiest bucket in the window
 *   - interruptions  online → offline transitions (a proxy for crashes/downtime)
 *
 * These are cheap local queries, so we fan out in parallel and refresh on a slow
 * interval. Servers with no history yet simply score zero and fall to the bottom.
 */
import React from 'react';
import { invoke } from '@tauri-apps/api/core';

import type { Server } from '@/data/servers';
import type { TelemetryHistoryPoint } from '@/pages/server/server-types';
import { toChartData, type ChartPoint } from '@/pages/server/stats/stats-utils';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_POINTS = 96;
const REFRESH_MS = 60000;

export type PlayerTrend = 'up' | 'down' | 'flat';

export type ServerActivity = {
	serverId: string;
	/** 0..1 fraction of buckets the server was online. */
	availability: number;
	avgPlayers: number;
	peakPlayers: number;
	/** online → offline transitions in the window. */
	interruptions: number;
	/** True when the window contained any telemetry at all. */
	hasData: boolean;
	/** Recent trend, ready for {@link TelemetrySparkline}. */
	chart: ChartPoint[];
	/** Player-count trend over the window (first half vs second half). */
	trend: PlayerTrend;
	/** Player-count sum by local hour-of-day (length 24). */
	hourBuckets: number[];
	/** Blended ranking score (higher = more used). */
	score: number;
};

export type DashboardActivity = {
	byServer: Map<string, ServerActivity>;
	/** Servers ordered most-used first (only those with telemetry data). */
	ranked: ServerActivity[];
	totalInterruptions: number;
	/** Summed player counts by local hour-of-day across all servers (length 24). */
	hourHistogram: number[];
	/** The single busiest hour-of-day (0..23), or null when there's no data. */
	peakHour: number | null;
	isLoading: boolean;
};

/**
 * Player-count trend: compares the mean of the first half of the window to the
 * second half. Pure and exported for tests.
 */
export const computeTrend = (points: TelemetryHistoryPoint[]): PlayerTrend => {
	const withPlayers = points.filter((point) => point.playersOnline != null);
	if (withPlayers.length < 4) return 'flat';
	const mid = Math.floor(withPlayers.length / 2);
	const mean = (slice: TelemetryHistoryPoint[]) =>
		slice.reduce((sum, point) => sum + (point.playersOnline ?? 0), 0) / Math.max(1, slice.length);
	const first = mean(withPlayers.slice(0, mid));
	const second = mean(withPlayers.slice(mid));
	const delta = second - first;
	if (delta > 0.5) return 'up';
	if (delta < -0.5) return 'down';
	return 'flat';
};

/** Sums player counts into 24 local hour-of-day buckets. Pure and exported. */
export const buildHourBuckets = (points: TelemetryHistoryPoint[]): number[] => {
	const buckets = new Array<number>(24).fill(0);
	for (const point of points) {
		if (point.playersOnline == null || point.playersOnline <= 0) continue;
		const hour = new Date(point.timestamp).getHours();
		if (hour >= 0 && hour < 24) buckets[hour] += point.playersOnline;
	}
	return buckets;
};

const summarize = (serverId: string, points: TelemetryHistoryPoint[]): ServerActivity => {
	const chart = toChartData(points);
	let onlineCount = 0;
	let playerSum = 0;
	let playerSamples = 0;
	let peakPlayers = 0;
	let interruptions = 0;
	let prevOnline = false;

	for (const point of points) {
		if (point.online) onlineCount += 1;
		if (prevOnline && !point.online) interruptions += 1;
		prevOnline = point.online;

		if (point.playersOnline != null) {
			playerSum += point.playersOnline;
			playerSamples += 1;
			if (point.playersOnline > peakPlayers) peakPlayers = point.playersOnline;
		}
	}

	const availability = points.length > 0 ? onlineCount / points.length : 0;
	const avgPlayers = playerSamples > 0 ? playerSum / playerSamples : 0;
	// Weight live activity (players) above mere uptime, but reward both.
	const score = avgPlayers * 12 + peakPlayers * 3 + availability * 10;

	return {
		serverId,
		availability,
		avgPlayers,
		peakPlayers,
		interruptions,
		hasData: points.length > 0,
		chart,
		trend: computeTrend(points),
		hourBuckets: buildHourBuckets(points),
		score,
	};
};

export const useDashboardActivity = (servers: Server[]): DashboardActivity => {
	const [byServer, setByServer] = React.useState<Map<string, ServerActivity>>(new Map());
	const [isLoading, setIsLoading] = React.useState(true);

	// Only re-run when the *set* of servers changes, not on every stats tick.
	const serverIds = servers.map((server) => server.id);
	const serverIdsKey = serverIds.join(',');

	React.useEffect(() => {
		const ids = serverIdsKey ? serverIdsKey.split(',') : [];
		if (ids.length === 0) {
			setByServer(new Map());
			setIsLoading(false);
			return;
		}

		let active = true;

		const load = async () => {
			const toTs = Date.now();
			const fromTs = toTs - SEVEN_DAYS_MS;
			const entries = await Promise.all(
				ids.map(async (id): Promise<[string, ServerActivity]> => {
					try {
						const points = await invoke<TelemetryHistoryPoint[]>(
							'get_server_telemetry_history',
							{ serverId: id, fromTs, toTs, maxPoints: MAX_POINTS },
						);
						return [id, summarize(id, points)];
					} catch {
						return [id, summarize(id, [])];
					}
				}),
			);
			if (!active) return;
			setByServer(new Map(entries));
			setIsLoading(false);
		};

		void load();
		const interval = window.setInterval(() => void load(), REFRESH_MS);
		return () => {
			active = false;
			window.clearInterval(interval);
		};
	}, [serverIdsKey]);

	return React.useMemo(() => {
		const all = Array.from(byServer.values());
		const ranked = all
			.filter((activity) => activity.hasData && activity.score > 0)
			.sort((left, right) => right.score - left.score);
		const totalInterruptions = all.reduce((sum, activity) => sum + activity.interruptions, 0);

		const hourHistogram = new Array<number>(24).fill(0);
		for (const activity of all) {
			for (let hour = 0; hour < 24; hour += 1) {
				hourHistogram[hour] += activity.hourBuckets[hour] ?? 0;
			}
		}
		const maxHour = Math.max(...hourHistogram);
		const peakHour = maxHour > 0 ? hourHistogram.indexOf(maxHour) : null;

		return { byServer, ranked, totalInterruptions, hourHistogram, peakHour, isLoading };
	}, [byServer, isLoading]);
};
