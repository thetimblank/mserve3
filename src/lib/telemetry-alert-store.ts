/**
 * App-wide low-TPS / high-memory alerts per server, keyed by directory. Fed by
 * `ServerRuntimeMonitor` from every `server-telemetry` event, so warnings keep
 * being tracked while the raw console is shown, on another tab, or with the
 * server's page closed. The activity feed reads them with
 * {@link useTelemetryAlerts}.
 */
import React from 'react';
import type { ActivityEvent } from './console-events';
import {
	createTelemetryAlertState,
	describeTelemetryAlert,
	noteTelemetrySample,
	type TelemetryAlertSample,
	type TelemetryAlertState,
} from './telemetry-alerts';

/** Rows kept per server (the feed keeps the same number). */
const ALERT_LIMIT = 100;
const EMPTY: ActivityEvent[] = [];

const trackers = new Map<string, TelemetryAlertState>();
const alertsByDirectory = new Map<string, ActivityEvent[]>();
const listeners = new Set<() => void>();

const emit = () => {
	for (const listener of listeners) listener();
};

/**
 * Feeds one telemetry sample in. Only online samples count; anything else
 * re-arms the tracker, so each run's startup is the warm-up it skips.
 */
export const noteServerTelemetry = (
	directory: string,
	sample: TelemetryAlertSample & { online: boolean },
	ramMode: string | undefined,
	now = Date.now(),
): void => {
	if (!sample.online) {
		trackers.delete(directory);
		return;
	}
	const result = noteTelemetrySample(trackers.get(directory) ?? createTelemetryAlertState(), sample, now);
	trackers.set(directory, result.state);
	if (result.alerts.length === 0) return;
	const rows = result.alerts.map((alert) => describeTelemetryAlert(alert, ramMode));
	alertsByDirectory.set(directory, [...(alertsByDirectory.get(directory) ?? EMPTY), ...rows].slice(-ALERT_LIMIT));
	emit();
};

/** Re-arms a server's tracker (it stopped, crashed, or went to sleep). Keeps its alerts. */
export const resetTelemetryTracker = (directory: string): void => {
	trackers.delete(directory);
};

export const getTelemetryAlerts = (directory: string): ActivityEvent[] => alertsByDirectory.get(directory) ?? EMPTY;

/** Forgets every tracker and alert (tests). */
export const clearTelemetryAlerts = (): void => {
	trackers.clear();
	alertsByDirectory.clear();
	emit();
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/** The telemetry alerts raised for a server this session, oldest first. */
export const useTelemetryAlerts = (directory: string | undefined): ActivityEvent[] =>
	React.useSyncExternalStore(subscribe, () => (directory ? getTelemetryAlerts(directory) : EMPTY));
