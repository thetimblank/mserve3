import { describe, expect, it } from 'vitest';
import {
	createTelemetryAlertState,
	describeTelemetryAlert,
	noteTelemetrySample,
	type TelemetryAlert,
	type TelemetryAlertSample,
	type TelemetryAlertState,
} from './telemetry-alerts';

const GIB = 1024 ** 3;

/** Feeds `samples` (one every 5 s from `start`) and collects every alert. */
const run = (
	samples: TelemetryAlertSample[],
	start = 0,
	initial: TelemetryAlertState = createTelemetryAlertState(),
) => {
	let state = initial;
	const alerts: TelemetryAlert[] = [];
	samples.forEach((sample, index) => {
		const result = noteTelemetrySample(state, sample, start + index * 5000);
		state = result.state;
		alerts.push(...result.alerts);
	});
	return { state, alerts };
};

const repeat = <T,>(value: T, times: number) => Array.from({ length: times }, () => value);

describe('noteTelemetrySample', () => {
	it('ignores everything during the warm-up minute', () => {
		const { alerts } = run(repeat({ tps: 5, ramBytes: 20 * GIB, heapMaxGb: 4 }, 12));
		expect(alerts).toEqual([]);
	});

	it('alerts once low TPS lasts 30 seconds', () => {
		const healthy = repeat({ tps: 20, ramBytes: null }, 13);
		const { alerts } = run([...healthy, ...repeat({ tps: 10, ramBytes: null }, 7)]);
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({ kind: 'low-tps', value: 10 });
	});

	it("doesn't alert on a short dip", () => {
		const healthy = repeat({ tps: 20, ramBytes: null }, 13);
		const { alerts } = run([...healthy, ...repeat({ tps: 10, ramBytes: null }, 3), ...healthy]);
		expect(alerts).toEqual([]);
	});

	it('stays quiet while TPS hovers between the thresholds', () => {
		const healthy = repeat({ tps: 20, ramBytes: null }, 13);
		const flapping = Array.from({ length: 40 }, (_, index) => ({ tps: index % 8 < 7 ? 12 : 16, ramBytes: null }));
		const { alerts } = run([...healthy, ...flapping]);
		expect(alerts).toHaveLength(1);
	});

	it('alerts again only after recovering and the cooldown', () => {
		const healthy = (n: number) => repeat({ tps: 20, ramBytes: null }, n);
		const slow = (n: number) => repeat({ tps: 10, ramBytes: null }, n);
		// Recovers then dips again within the 10 minute cooldown: one alert.
		expect(run([...healthy(13), ...slow(8), ...healthy(2), ...slow(8)]).alerts).toHaveLength(1);
		// After the cooldown: a second alert.
		expect(run([...healthy(13), ...slow(8), ...healthy(130), ...slow(8)]).alerts).toHaveLength(2);
	});

	const ram = (gb: number, heapMaxGb: number | null = 4) => ({ tps: null, ramBytes: gb * GIB, heapMaxGb });

	it('stays quiet while a healthy JVM sits past its heap', () => {
		// A full 4 GB heap plus the JVM's own memory reads ~5 GB.
		const { alerts } = run([...repeat(ram(2), 13), ...repeat(ram(5), 60)]);
		expect(alerts).toEqual([]);
	});

	it('alerts when memory stays well past the live heap cap for two minutes', () => {
		// 4 GB heap: the line is 4 × 1.2 + 1 = 5.8 GB.
		const short = run([...repeat(ram(2), 13), ...repeat(ram(6.5), 20)]);
		expect(short.alerts).toEqual([]);
		const { alerts } = run([...repeat(ram(2), 13), ...repeat(ram(6.5), 26)]);
		expect(alerts).toEqual([expect.objectContaining({ kind: 'high-ram', value: 6.5, heapGb: 4 })]);
	});

	it('measures against the heap the run started with', () => {
		// The same 6.5 GB is fine for a 6 GB auto cap (line: 8.2 GB).
		expect(run([...repeat(ram(2, 6), 13), ...repeat(ram(6.5, 6), 40)]).alerts).toEqual([]);
	});

	it('treats missing readings as healthy', () => {
		expect(run(repeat({ tps: null, ramBytes: null }, 40)).alerts).toEqual([]);
		// No known heap: nothing to compare against.
		expect(run(repeat(ram(30, null), 60)).alerts).toEqual([]);
	});
});

describe('describeTelemetryAlert', () => {
	it('words a low TPS alert', () => {
		const event = describeTelemetryAlert({ kind: 'low-tps', value: 11.24, at: 1000 });
		expect(event).toMatchObject({ kind: 'low-tps', tone: 'warning', title: 'Server is running slow', at: 1000 });
		expect(event.detail).toContain('11.2 of 20');
	});

	it('words a high RAM alert with the heap limit when known', () => {
		const manual = describeTelemetryAlert({ kind: 'high-ram', value: 6.54, at: 1, heapGb: 4 }, 'manual');
		expect(manual.title).toBe('Server is using a lot of memory');
		expect(manual.detail).toContain('using 6.5 GB with a 4 GB limit for the game');
		expect(manual.detail).toContain('give it more RAM in Settings');
		expect(describeTelemetryAlert({ kind: 'high-ram', value: 6, at: 1 }).detail).toContain('using 6 GB.');
	});

	it('points auto RAM servers at freeing memory instead', () => {
		const auto = describeTelemetryAlert({ kind: 'high-ram', value: 6, at: 1, heapGb: 4 }, 'auto');
		expect(auto.detail).toContain('Auto memory can give it more');
		expect(auto.detail).not.toContain('—');
	});
});
