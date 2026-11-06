import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { OnlinePlayers } from '@/lib/player-actions';
import { getErrorMessage } from '@/lib/utils';

// A safety net: joins and leaves already trigger a refresh through the live
// player count, this catches op/whitelist/rule changes made elsewhere.
const POLL_INTERVAL_MS = 15000;

type Args = {
	directory: string;
	/** Off while the server isn't online (or is a proxy): nothing is polled. */
	enabled: boolean;
	/** The live player count from telemetry; a change triggers a refresh. */
	playersOnline: number | null;
};

type Result = {
	data: OnlinePlayers | null;
	error: string | null;
	refresh: () => void;
};

/** The online players of one server over RCON, kept fresh while `enabled`. */
export const useOnlinePlayers = ({ directory, enabled, playersOnline }: Args): Result => {
	const [data, setData] = React.useState<OnlinePlayers | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const inFlight = React.useRef(false);
	const queued = React.useRef(false);
	const activeRef = React.useRef(enabled);
	activeRef.current = enabled;
	const directoryRef = React.useRef(directory);
	directoryRef.current = directory;

	const refresh = React.useCallback(() => {
		if (!activeRef.current) return;
		if (inFlight.current) {
			queued.current = true;
			return;
		}
		inFlight.current = true;
		// A reply for a server the page has since left (or that went offline) is dropped.
		const isCurrent = () => activeRef.current && directoryRef.current === directory;
		invoke<OnlinePlayers>('get_online_players', { directory })
			.then((result) => {
				if (!isCurrent()) return;
				setData(result);
				setError(null);
			})
			.catch((err) => {
				if (!isCurrent()) return;
				setError(getErrorMessage(err, 'Could not read the player list.'));
			})
			.finally(() => {
				inFlight.current = false;
				if (queued.current) {
					queued.current = false;
					latestRefresh.current();
				}
			});
	}, [directory]);
	// The queued re-run uses the newest `refresh`, so it targets the current server.
	const latestRefresh = React.useRef(refresh);
	latestRefresh.current = refresh;

	React.useEffect(() => {
		setData(null);
		setError(null);
	}, [directory, enabled]);

	React.useEffect(() => {
		if (!enabled) return;
		refresh();
		const intervalId = window.setInterval(refresh, POLL_INTERVAL_MS);
		return () => window.clearInterval(intervalId);
	}, [enabled, refresh, playersOnline]);

	return { data, error, refresh };
};
