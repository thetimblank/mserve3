import React from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Server } from '@/data/servers';
import { buildConsoleActivity, mergeActivityEvents, type ActivityEvent } from '@/lib/console-events';
import {
	createTelemetryAlertState,
	describeTelemetryAlert,
	noteTelemetrySample,
} from '@/lib/telemetry-alerts';
import type { ServerTelemetryEvent } from '../server-types';
import { resolveManualRamGb } from '@/lib/ram-utils';

// Rows the feed keeps; console history is already capped by the terminal hook.
const ACTIVITY_LIMIT = 100;

type Args = {
	server: Pick<Server, 'directory' | 'status' | 'ram'> | undefined;
	terminalLines: string[];
	/** Off while the feed isn't shown, so nothing is parsed or listened to. */
	enabled: boolean;
};

/**
 * The beginner activity feed for one server, newest first: known console
 * events (from the stored terminal lines, so they survive navigation) merged
 * with debounced low-TPS / high-RAM alerts from live telemetry.
 */
export const useServerActivity = ({ server, terminalLines, enabled }: Args): ActivityEvent[] => {
	const directory = server?.directory;
	const isOnline = server?.status === 'online';
	const ramRef = React.useRef(server ? resolveManualRamGb(server) : null);
	ramRef.current = server ? resolveManualRamGb(server) : null;
	const [alerts, setAlerts] = React.useState<ActivityEvent[]>([]);

	React.useEffect(() => {
		setAlerts([]);
	}, [directory]);

	// Telemetry alerts, re-armed each time the server comes online (startup
	// is the warm-up the tracker skips).
	React.useEffect(() => {
		if (!enabled || !directory || !isOnline) return;
		let tracker = createTelemetryAlertState();
		let unlisten: UnlistenFn | null = null;
		let active = true;

		listen<ServerTelemetryEvent>('server-telemetry', (event) => {
			if (!active || event.payload.directory !== directory) return;
			const { sample } = event.payload;
			if (!sample.online) return;
			const result = noteTelemetrySample(tracker, sample, Date.now());
			tracker = result.state;
			if (result.alerts.length === 0) return;
			const rows = result.alerts.map((alert) => describeTelemetryAlert(alert, ramRef.current));
			setAlerts((previous) => [...previous, ...rows].slice(-ACTIVITY_LIMIT));
		})
			.then((cleanup) => {
				if (!active) {
					cleanup();
					return;
				}
				unlisten = cleanup;
			})
			.catch(() => {});

		return () => {
			active = false;
			unlisten?.();
		};
	}, [directory, enabled, isOnline]);

	const consoleEvents = React.useMemo(
		() => (enabled ? buildConsoleActivity(terminalLines) : []),
		[enabled, terminalLines],
	);

	return React.useMemo(
		() => mergeActivityEvents(consoleEvents, alerts).slice(-ACTIVITY_LIMIT).reverse(),
		[alerts, consoleEvents],
	);
};
