import { describe, expect, it } from 'vitest';
import { mapRuntimeStateToStatus, mapSampleToStats } from './server-telemetry';
import type { TelemetrySample } from '@/pages/server/server-types';

describe('mapRuntimeStateToStatus', () => {
	it('maps lifecycle states to UI status', () => {
		expect(mapRuntimeStateToStatus('starting')).toBe('starting');
		expect(mapRuntimeStateToStatus('online')).toBe('online');
		// An adopted external server reads as online.
		expect(mapRuntimeStateToStatus('running-external')).toBe('online');
		expect(mapRuntimeStateToStatus('stopping')).toBe('closing');
		// Crashed reads as offline for status (crash surfaced separately).
		expect(mapRuntimeStateToStatus('crashed')).toBe('offline');
		expect(mapRuntimeStateToStatus('offline')).toBe('offline');
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
