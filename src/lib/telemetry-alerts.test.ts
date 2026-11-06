import { describe, expect, it } from 'vitest';
import {
	createTelemetryAlertState,
	describeTelemetryAlert,
	noteTelemetrySample,
	type TelemetryAlert,
	type TelemetryAlertState,
} from './telemetry-alerts';

/** Feeds `samples` (one every 5 s from `start`) and collects every alert. */
const run = (
	samples: { tps: number | null; ramUsed: number | null }[],
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
		const { alerts } = run(repeat({ tps: 5, ramUsed: 99 }, 12));
		expect(alerts).toEqual([]);
	});

	it('alerts once low TPS lasts 30 seconds', () => {
		const healthy = repeat({ tps: 20, ramUsed: 50 }, 13);
		const { alerts } = run([...healthy, ...repeat({ tps: 10, ramUsed: 50 }, 7)]);
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({ kind: 'low-tps', value: 10 });
	});

	it("doesn't alert on a short dip", () => {
		const healthy = repeat({ tps: 20, ramUsed: 50 }, 13);
		const { alerts } = run([...healthy, ...repeat({ tps: 10, ramUsed: 50 }, 3), ...healthy]);
		expect(alerts).toEqual([]);
	});

	it('stays quiet while TPS hovers between the thresholds', () => {
		const healthy = repeat({ tps: 20, ramUsed: 50 }, 13);
		const flapping = Array.from({ length: 40 }, (_, index) => ({ tps: index % 8 < 7 ? 12 : 16, ramUsed: 50 }));
		const { alerts } = run([...healthy, ...flapping]);
		expect(alerts).toHaveLength(1);
	});

	it('alerts again only after recovering and the cooldown', () => {
		const healthy = (n: number) => repeat({ tps: 20, ramUsed: 50 }, n);
		const slow = (n: number) => repeat({ tps: 10, ramUsed: 50 }, n);
		// Recovers then dips again within the 10 minute cooldown: one alert.
		expect(run([...healthy(13), ...slow(8), ...healthy(2), ...slow(8)]).alerts).toHaveLength(1);
		// After the cooldown: a second alert.
		expect(run([...healthy(13), ...slow(8), ...healthy(130), ...slow(8)]).alerts).toHaveLength(2);
	});

	it('alerts on sustained high RAM', () => {
		const { alerts } = run([...repeat({ tps: null, ramUsed: 40 }, 13), ...repeat({ tps: null, ramUsed: 97 }, 7)]);
		expect(alerts).toEqual([expect.objectContaining({ kind: 'high-ram', value: 97 })]);
	});

	it('treats missing readings as healthy', () => {
		const { alerts } = run(repeat({ tps: null, ramUsed: null }, 40));
		expect(alerts).toEqual([]);
	});
});

describe('describeTelemetryAlert', () => {
	it('words a low TPS alert', () => {
		const event = describeTelemetryAlert({ kind: 'low-tps', value: 11.24, at: 1000 });
		expect(event).toMatchObject({ kind: 'low-tps', tone: 'warning', title: 'Server is running slow', at: 1000 });
		expect(event.detail).toContain('11.2 of 20');
	});

	it('words a high RAM alert with the allocation when known', () => {
		expect(describeTelemetryAlert({ kind: 'high-ram', value: 96.4, at: 1 }, 4).detail).toContain('96% of its 4 GB');
		expect(describeTelemetryAlert({ kind: 'high-ram', value: 96.4, at: 1 }).detail).toContain('96% of its memory');
	});
});
