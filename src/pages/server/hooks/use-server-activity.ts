import React from 'react';
import type { Server } from '@/data/servers';
import { buildConsoleActivity, mergeActivityEvents, type ActivityEvent } from '@/lib/console-events';
import { useTelemetryAlerts } from '@/lib/telemetry-alert-store';

// Rows the feed keeps; console history is already capped by the terminal hook.
const ACTIVITY_LIMIT = 100;

type Args = {
	server: Pick<Server, 'directory'> | undefined;
	terminalLines: string[];
	/** Off while the feed isn't shown, so the console isn't parsed. */
	enabled: boolean;
};

/**
 * The beginner activity feed for one server, newest first: known console
 * events (from the stored terminal lines, so they survive navigation) merged
 * with the debounced low-TPS / high-RAM alerts, which the runtime monitor
 * tracks for every server whether or not the feed is shown.
 */
export const useServerActivity = ({ server, terminalLines, enabled }: Args): ActivityEvent[] => {
	const alerts = useTelemetryAlerts(enabled ? server?.directory : undefined);

	const consoleEvents = React.useMemo(
		() => (enabled ? buildConsoleActivity(terminalLines) : []),
		[enabled, terminalLines],
	);

	return React.useMemo(
		() => mergeActivityEvents(consoleEvents, alerts).slice(-ACTIVITY_LIMIT).reverse(),
		[alerts, consoleEvents],
	);
};
