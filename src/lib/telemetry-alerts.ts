/**
 * Debounced "server is struggling" alerts from telemetry samples, for the
 * beginner activity feed. Pure: the caller feeds samples in and keeps the
 * returned state (`telemetry-alert-store.ts` does, for every server).
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

/** Memory past the heap, as `heap × factor + overheadGb`. */
type RamLine = { heapFactor: number; overheadGb: number };

export type TelemetryAlertOptions = {
	/** Samples this soon after the first one are ignored (startup is busy). */
	warmupMs: number;
	/** How long low TPS must last before it alerts. */
	sustainMs: number;
	/** How long high memory must last before it alerts. */
	ramSustainMs: number;
	cooldownMs: number;
	lowTps: number;
	recoveredTps: number;
	highRam: RamLine;
	recoveredRam: RamLine;
};

export const DEFAULT_TELEMETRY_ALERT_OPTIONS: TelemetryAlertOptions = {
	warmupMs: 60_000,
	sustainMs: 30_000,
	ramSustainMs: 2 * 60_000,
	cooldownMs: 10 * 60_000,
	lowTps: 15,
	recoveredTps: 18,
	// Memory is the whole process (RSS), measured against the max heap this run
	// started with (auto RAM's live cap, or the manual heap). Besides the heap a
	// JVM holds class metadata, JIT code, thread stacks, GC bookkeeping and
	// network buffers, so a healthy server with a full heap reads ~100–125% of
	// it. Only memory well past that alerts; a truly full heap shows up as low
	// TPS and an OutOfMemoryError in the console (both already in the feed).
	highRam: { heapFactor: 1.2, overheadGb: 1 },
	recoveredRam: { heapFactor: 1.1, overheadGb: 0.5 },
};

const GIB = 1024 ** 3;

const ramLineBytes = (heapGb: number, line: RamLine) => (heapGb * line.heapFactor + line.overheadGb) * GIB;

export type TelemetryAlert = {
	kind: TelemetryAlertKind;
	/** TPS for `low-tps`; process memory in GB for `high-ram`. */
	value: number;
	at: number;
	/** The max heap the run started with (`high-ram` only). */
	heapGb?: number;
};

/** What a sample needs for the alerts (a subset of the telemetry sample). */
export type TelemetryAlertSample = {
	tps: number | null;
	/** Process memory (RSS) in bytes. */
	ramBytes: number | null;
	/** The max heap this run started with, in GB. */
	heapMaxGb?: number | null;
};

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
	sustainMs: number,
): { watch: MetricWatch; fire: boolean } => {
	if (!isBad) {
		return {
			watch: { ...watch, badSince: null, firing: isRecovered ? false : watch.firing },
			fire: false,
		};
	}
	const badSince = watch.badSince ?? now;
	const sustained = now - badSince >= sustainMs;
	const cooledDown = watch.lastAlertAt == null || now - watch.lastAlertAt >= options.cooldownMs;
	if (sustained && !watch.firing && cooledDown) {
		return { watch: { badSince, firing: true, lastAlertAt: now }, fire: true };
	}
	return { watch: { ...watch, badSince }, fire: false };
};

/** Feeds one sample in; returns the next state and any alerts it raised. */
export const noteTelemetrySample = (
	state: TelemetryAlertState,
	sample: TelemetryAlertSample,
	now: number,
	options: TelemetryAlertOptions = DEFAULT_TELEMETRY_ALERT_OPTIONS,
): { state: TelemetryAlertState; alerts: TelemetryAlert[] } => {
	const firstSampleAt = state.firstSampleAt ?? now;
	if (now - firstSampleAt < options.warmupMs) {
		return { state: { ...state, firstSampleAt }, alerts: [] };
	}

	const alerts: TelemetryAlert[] = [];
	const { tps, ramBytes } = sample;
	const heapGb = sample.heapMaxGb != null && sample.heapMaxGb > 0 ? sample.heapMaxGb : null;

	const tpsStep = stepWatch(
		state.tps,
		tps != null && tps < options.lowTps,
		tps != null && tps >= options.recoveredTps,
		now,
		options,
		options.sustainMs,
	);
	if (tpsStep.fire && tps != null) alerts.push({ kind: 'low-tps', value: tps, at: now });

	// Without a known heap there's nothing to compare against: read as healthy.
	const hasRam = ramBytes != null && heapGb != null;
	const ramStep = stepWatch(
		state.ram,
		hasRam && ramBytes >= ramLineBytes(heapGb, options.highRam),
		hasRam && ramBytes < ramLineBytes(heapGb, options.recoveredRam),
		now,
		options,
		options.ramSustainMs,
	);
	if (ramStep.fire && hasRam) {
		alerts.push({ kind: 'high-ram', value: ramBytes / GIB, at: now, heapGb });
	}

	return { state: { firstSampleAt, tps: tpsStep.watch, ram: ramStep.watch }, alerts };
};

const formatGb = (gb: number) => `${Math.round(gb * 10) / 10} GB`;

/** The feed row for a telemetry alert. `ramMode` picks the advice for a high-memory alert. */
export const describeTelemetryAlert = (alert: TelemetryAlert, ramMode?: string): ActivityEvent => {
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
	const limit = alert.heapGb != null ? ` with a ${formatGb(alert.heapGb)} limit for the game` : '';
	const advice =
		ramMode === 'auto'
			? 'If it lags or crashes, close other servers or apps so Auto memory can give it more on the next start, or remove heavy plugins or mods.'
			: 'If it lags or crashes, give it more RAM in Settings, or remove heavy plugins or mods.';
	return {
		id,
		kind: 'high-ram',
		tone: 'warning',
		title: 'Server is using a lot of memory',
		detail: `It is using ${formatGb(alert.value)}${limit}. ${advice}`,
		at: alert.at,
		count: 1,
	};
};
