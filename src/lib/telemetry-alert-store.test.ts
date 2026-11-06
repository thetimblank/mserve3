import { afterEach, describe, expect, it } from 'vitest';
import {
	clearTelemetryAlerts,
	getTelemetryAlerts,
	noteServerTelemetry,
	resetTelemetryTracker,
} from './telemetry-alert-store';

const slow = { online: true, tps: 8, ramBytes: null };

/** Feeds `count` samples, one every 5 s from `start`. */
const feed = (directory: string, sample: typeof slow, count: number, start = 0) => {
	for (let index = 0; index < count; index++) {
		noteServerTelemetry(directory, sample, 'manual', start + index * 5000);
	}
};

afterEach(() => clearTelemetryAlerts());

describe('telemetry alert store', () => {
	it('keeps alerts per server', () => {
		// 60 s warm-up, then 30 s of low TPS.
		feed('/a', slow, 20);
		expect(getTelemetryAlerts('/a')).toEqual([expect.objectContaining({ kind: 'low-tps' })]);
		expect(getTelemetryAlerts('/b')).toEqual([]);
	});

	it('re-arms the warm-up when the server stops, keeping earlier alerts', () => {
		feed('/a', slow, 20);
		resetTelemetryTracker('/a');
		// A new run: the first minute is warm-up again, so nothing new yet.
		feed('/a', slow, 12, 1_000_000);
		expect(getTelemetryAlerts('/a')).toHaveLength(1);
	});

	it('treats an offline sample as the end of a run', () => {
		feed('/a', slow, 10);
		noteServerTelemetry('/a', { ...slow, online: false }, 'manual', 50_000);
		feed('/a', slow, 12, 55_000);
		expect(getTelemetryAlerts('/a')).toEqual([]);
	});
});
