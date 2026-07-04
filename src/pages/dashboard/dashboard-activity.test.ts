import { describe, expect, it } from 'vitest';
import { buildHourBuckets, computeTrend } from './use-dashboard-activity';
import type { TelemetryHistoryPoint } from '@/pages/server/server-types';

const point = (timestamp: number, playersOnline: number | null): TelemetryHistoryPoint => ({
	timestamp,
	online: playersOnline != null,
	sleeping: false,
	playersOnline,
	tps: null,
	ramBytes: null,
	ramUsed: null,
	cpuUsed: null,
});

describe('computeTrend', () => {
	it('returns flat with too little data', () => {
		expect(computeTrend([point(0, 1), point(1, 2)])).toBe('flat');
	});

	it('detects an upward trend', () => {
		const points = [point(0, 0), point(1, 0), point(2, 5), point(3, 6)];
		expect(computeTrend(points)).toBe('up');
	});

	it('detects a downward trend', () => {
		const points = [point(0, 8), point(1, 7), point(2, 1), point(3, 0)];
		expect(computeTrend(points)).toBe('down');
	});

	it('ignores null player readings', () => {
		const points = [point(0, null), point(1, 3), point(2, 3), point(3, null), point(4, 3), point(5, 3)];
		expect(computeTrend(points)).toBe('flat');
	});
});

describe('buildHourBuckets', () => {
	it('sums player counts into the correct local hour bucket', () => {
		// Build a timestamp at a known local hour.
		const at9am = new Date();
		at9am.setHours(9, 0, 0, 0);
		const at9pm = new Date();
		at9pm.setHours(21, 0, 0, 0);

		const buckets = buildHourBuckets([
			point(at9am.getTime(), 4),
			point(at9am.getTime(), 2),
			point(at9pm.getTime(), 5),
			point(at9am.getTime(), 0), // zero players contributes nothing
			point(at9am.getTime(), null), // null contributes nothing
		]);

		expect(buckets).toHaveLength(24);
		expect(buckets[9]).toBe(6);
		expect(buckets[21]).toBe(5);
		expect(buckets.reduce((a, b) => a + b, 0)).toBe(11);
	});
});
