/**
 * Pulls bucket-averaged telemetry history for a single server from the SQLite
 * time-series store via the `get_server_telemetry_history` command. Both the
 * overview sparklines (short window) and the dedicated Statistics page use this
 * one hook so there is a single data path.
 *
 * The frontend `server.id` is the same value the backend stores as `server_id`
 * (see `resolve_server_id`), so we pass it straight through.
 */
import React from 'react';
import { invoke } from '@tauri-apps/api/core';

import type { TelemetryHistoryPoint } from '@/pages/server/server-types';

type Options = {
	/** Roughly how many points to request (the backend buckets to fit). */
	maxPoints?: number;
	/** Poll interval in ms so the charts stay near-live. */
	refreshMs?: number;
	/** Set false to pause fetching (e.g. tab not visible). */
	enabled?: boolean;
};

type Result = {
	points: TelemetryHistoryPoint[];
	isLoading: boolean;
	error: string | null;
	/** Epoch ms of the last successful fetch, or null. */
	updatedAt: number | null;
	refetch: () => void;
};

const DEFAULT_MAX_POINTS = 180;
const DEFAULT_REFRESH_MS = 15000;

export const useServerTelemetryHistory = (
	serverId: string,
	rangeMs: number,
	options: Options = {},
): Result => {
	const { maxPoints = DEFAULT_MAX_POINTS, refreshMs = DEFAULT_REFRESH_MS, enabled = true } = options;

	const [points, setPoints] = React.useState<TelemetryHistoryPoint[]>([]);
	const [isLoading, setIsLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
	// Bumped by refetch() to force the effect to re-run on demand.
	const [nonce, setNonce] = React.useState(0);

	const refetch = React.useCallback(() => setNonce((value) => value + 1), []);

	React.useEffect(() => {
		if (!enabled || !serverId.trim()) {
			setPoints([]);
			return;
		}

		let active = true;
		let inFlight = false;

		const poll = async () => {
			if (inFlight) return;
			inFlight = true;
			setIsLoading((prev) => (points.length === 0 ? true : prev));
			const toTs = Date.now();
			const fromTs = toTs - rangeMs;
			try {
				const result = await invoke<TelemetryHistoryPoint[]>('get_server_telemetry_history', {
					serverId,
					fromTs,
					toTs,
					maxPoints,
				});
				if (!active) return;
				setPoints(result);
				setError(null);
				setUpdatedAt(Date.now());
			} catch (err) {
				if (!active) return;
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				if (active) setIsLoading(false);
				inFlight = false;
			}
		};

		void poll();
		const interval = window.setInterval(() => void poll(), refreshMs);
		return () => {
			active = false;
			window.clearInterval(interval);
		};
		// `points.length` intentionally omitted: only used for the first-load spinner.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [serverId, rangeMs, maxPoints, refreshMs, enabled, nonce]);

	return { points, isLoading, error, updatedAt, refetch };
};
