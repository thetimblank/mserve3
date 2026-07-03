import { describe, expect, it } from 'vitest';
import { mapRuntimeStateToStatus, mapSampleToStats } from './server-telemetry';
import { isRunningStatus, isStoppedStatus } from '@/data/servers';
import type { TelemetrySample } from '@/pages/server/server-types';

describe('mapRuntimeStateToStatus', () => {
	it('maps lifecycle states to UI status', () => {
		expect(mapRuntimeStateToStatus('starting')).toBe('starting');
		expect(mapRuntimeStateToStatus('online')).toBe('online');
		// An adopted external server reads as online.
		expect(mapRuntimeStateToStatus('running-external')).toBe('online');
		expect(mapRuntimeStateToStatus('stopping')).toBe('closing');
		// Crashed and sleeping now have their own statuses (no longer collapsed).
		expect(mapRuntimeStateToStatus('crashed')).toBe('crashed');
		expect(mapRuntimeStateToStatus('sleeping')).toBe('sleeping');
		expect(mapRuntimeStateToStatus('offline')).toBe('offline');
	});
});

describe('status predicates', () => {
	it('isStoppedStatus: offline and crashed are stopped; sleeping is not', () => {
		expect(isStoppedStatus('offline')).toBe(true);
		expect(isStoppedStatus('crashed')).toBe(true);
		expect(isStoppedStatus('sleeping')).toBe(false);
		expect(isStoppedStatus('online')).toBe(false);
		expect(isStoppedStatus('starting')).toBe(false);
		expect(isStoppedStatus('closing')).toBe(false);
	});

	it('isRunningStatus: online and starting are running', () => {
		expect(isRunningStatus('online')).toBe(true);
		expect(isRunningStatus('starting')).toBe(true);
		expect(isRunningStatus('sleeping')).toBe(false);
		expect(isRunningStatus('crashed')).toBe(false);
		expect(isRunningStatus('offline')).toBe(false);
	});
});

describe('mapSampleToStats', () => {
	const base: TelemetrySample = {
		timestamp: 0,
		online: true,
		playersOnline: 2,
		playersMax: 20,
		serverVersion: '1.21',
		providerVersion: '196',
		tps: 19.9,
		ramUsed: 55.5,
		ramBytes: 1_000_000,
		cpuUsed: 12.3,
		uptime: '2024-01-01T00:00:00.000Z',
	};

	it('maps camelCase sample fields to snake_case stats', () => {
		const stats = mapSampleToStats(base);
		expect(stats).toMatchObject({
			online: true,
			players_online: 2,
			players_max: 20,
			server_version: '1.21',
			provider_version: '196',
			tps: 19.9,
			ram_used: 55.5,
			cpu_used: 12.3,
		});
		expect(stats.uptime).toBeInstanceOf(Date);
		expect((stats.uptime as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z');
	});

	it('falls back to provided uptime when the sample has none', () => {
		const fallback = new Date('2025-06-01T00:00:00.000Z');
		const stats = mapSampleToStats({ ...base, uptime: null }, { fallbackUptime: fallback });
		expect(stats.uptime).toBe(fallback);
	});

	it('ignores an unparseable uptime string', () => {
		const stats = mapSampleToStats({ ...base, uptime: 'not-a-date' });
		expect(stats.uptime).toBeNull();
	});
});
