/**
 * Batched disk-usage across every server for the dashboard's storage insights.
 * One `get_servers_storage` call returns the total directory size plus the
 * worlds/backups split for each server. The scan touches the filesystem, so we
 * refresh on a slow interval and keep the last result while refreshing.
 */
import React from 'react';
import { invoke } from '@tauri-apps/api/core';

import type { Server } from '@/data/servers';

const REFRESH_MS = 5 * 60 * 1000;

export type ServerStorageInfo = {
	directory: string;
	totalBytes: number;
	worldsBytes: number;
	backupsBytes: number;
};

export type DashboardStorage = {
	/** Keyed by server directory. */
	byDirectory: Map<string, ServerStorageInfo>;
	totalBytes: number;
	worldsBytes: number;
	backupsBytes: number;
	isLoading: boolean;
};

export const useDashboardStorage = (servers: Server[]): DashboardStorage => {
	const [byDirectory, setByDirectory] = React.useState<Map<string, ServerStorageInfo>>(new Map());
	const [isLoading, setIsLoading] = React.useState(true);

	// Only re-run when the set of directories changes, not on every stats tick.
	const directoriesKey = servers.map((server) => server.directory).join('\n');

	React.useEffect(() => {
		const directories = directoriesKey ? directoriesKey.split('\n') : [];
		if (directories.length === 0) {
			setByDirectory(new Map());
			setIsLoading(false);
			return;
		}

		let active = true;
		const load = async () => {
			try {
				const results = await invoke<ServerStorageInfo[]>('get_servers_storage', { directories });
				if (!active) return;
				setByDirectory(new Map(results.map((entry) => [entry.directory, entry])));
			} catch {
				// Keep the last result on a transient failure.
			} finally {
				if (active) setIsLoading(false);
			}
		};

		void load();
		const interval = window.setInterval(() => void load(), REFRESH_MS);
		return () => {
			active = false;
			window.clearInterval(interval);
		};
	}, [directoriesKey]);

	return React.useMemo(() => {
		let totalBytes = 0;
		let worldsBytes = 0;
		let backupsBytes = 0;
		for (const info of byDirectory.values()) {
			totalBytes += info.totalBytes;
			worldsBytes += info.worldsBytes;
			backupsBytes += info.backupsBytes;
		}
		return { byDirectory, totalBytes, worldsBytes, backupsBytes, isLoading };
	}, [byDirectory, isLoading]);
};
