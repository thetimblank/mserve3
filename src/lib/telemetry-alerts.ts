/**
 * Debounced "server is struggling" alerts from telemetry samples, for the
 * beginner activity feed. Pure: the caller feeds samples in and keeps the
 * returned state.
 *
 * A metric alerts once it stays past its threshold for `sustainMs`, then stays
 * quiet until it recovers past a second threshold (hysteresis) and the cooldown
 * has passed, so a value hovering at the line doesn't spam the feed.
 */
import type { ActivityEvent, TelemetryAlertKind } from './console-events';

type MetricWatch = {
	badSince: number | null;
	firing: boolean;
	lastAlertAt: number | null;
};

export type TelemetryAlertState = {
	firstSampleAt: number | null;
	tps: MetricWatch;
	ram: MetricWatch;
};

export type TelemetryAlertOptions = {
	/** Samples this soon after the first one are ignored (startup is busy). */
	warmupMs: number;
	sustainMs: number;
	cooldownMs: number;
	lowTps: number;
	recoveredTps: number;
	highRamPercent: number;
	recoveredRamPercent: number;
};

export const DEFAULT_TELEMETRY_ALERT_OPTIONS: TelemetryAlertOptions = {
	warmupMs: 60_000,
	sustainMs: 30_000,
	cooldownMs: 10 * 60_000,
	lowTps: 15,
	recoveredTps: 18,
	// RAM is the process's memory against the configured allocation; a JVM
	// sits fairly high there normally, so only a near-full reading alerts.
	highRamPercent: 95,
	recoveredRamPercent: 85,
};

export type TelemetryAlert = { kind: TelemetryAlertKind; value: number; at: number };

const idleWatch = (): MetricWatch => ({ badSince: null, firing: false, lastAlertAt: null });

export const createTelemetryAlertState = (): TelemetryAlertState => ({
	firstSampleAt: null,
	tps: idleWatch(),
	ram: idleWatch(),
});

const stepWatch = (
	watch: MetricWatch,
	isBad: boolean,
	isRecovered: boolean,
	now: number,
	options: TelemetryAlertOptions,
): { watch: MetricWatch; fire: boolean } => {
	if (!isBad) {
		return {
			watch: { ...watch, badSince: null, firing: isRecovered ? false : watch.firing },
			fire: false,
		};
	}
	const badSince = watch.badSince ?? now;
	const sustained = now - badSince >= options.sustainMs;
	const cooledDown = watch.lastAlertAt == null || now - watch.lastAlertAt >= options.cooldownMs;
	if (sustained && !watch.firing && cooledDown) {
		return { watch: { badSince, firing: true, lastAlertAt: now }, fire: true };
	}
	return { watch: { ...watch, badSince }, fire: false };
};

/** Feeds one sample in; returns the next state and any alerts it raised. */
export const noteTelemetrySample = (
	state: TelemetryAlertState,
	sample: { tps: number | null; ramUsed: number | null },
	now: number,
	options: TelemetryAlertOptions = DEFAULT_TELEMETRY_ALERT_OPTIONS,
): { state: TelemetryAlertState; alerts: TelemetryAlert[] } => {
	const firstSampleAt = state.firstSampleAt ?? now;
	if (now - firstSampleAt < options.warmupMs) {
		return { state: { ...state, firstSampleAt }, alerts: [] };
	}

	const alerts: TelemetryAlert[] = [];
	const { tps, ramUsed } = sample;

	const tpsStep = stepWatch(
		state.tps,
		tps != null && tps < options.lowTps,
		tps != null && tps >= options.recoveredTps,
		now,
		options,
	);
	if (tpsStep.fire && tps != null) alerts.push({ kind: 'low-tps', value: tps, at: now });

	const ramStep = stepWatch(
		state.ram,
		ramUsed != null && ramUsed >= options.highRamPercent,
		ramUsed != null && ramUsed < options.recoveredRamPercent,
		now,
		options,
	);
	if (ramStep.fire && ramUsed != null) alerts.push({ kind: 'high-ram', value: ramUsed, at: now });

	return { state: { firstSampleAt, tps: tpsStep.watch, ram: ramStep.watch }, alerts };
};

/** The feed row for a telemetry alert. `ramGb` is the server's allocation. */
export const describeTelemetryAlert = (alert: TelemetryAlert, ramGb?: number | null): ActivityEvent => {
	const id = `${alert.kind}-${alert.at}`;
	if (alert.kind === 'low-tps') {
		return {
			id,
			kind: 'low-tps',
			tone: 'warning',
			title: 'Server is running slow',
			detail: `It is running at ${alert.value.toFixed(1)} of 20 ticks per second, so the game may feel laggy. Fewer players, plugins, or loaded chunks help.`,
			at: alert.at,
			count: 1,
		};
	}
	const percent = Math.round(alert.value);
	const of = ramGb != null && ramGb > 0 ? ` of its ${ramGb} GB` : ' of its memory';
	return {
		id,
		kind: 'high-ram',
		tone: 'warning',
		title: 'Server is almost out of memory',
		detail: `It is using ${percent}%${of}. If it slows down or crashes, give it more RAM in Settings.`,
		at: alert.at,
		count: 1,
	};
};
