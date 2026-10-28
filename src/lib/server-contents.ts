import { invoke } from '@tauri-apps/api/core';
import type { ServerUpdate } from '@/data/servers';
import type { ScanServerContentsResult } from '@/pages/server/server-types';
import { mapScannedBackups } from '@/pages/server/server-utils';

/** Rescans a server's plugins, mods, worlds, datapacks and backups as a store update. */
export const scanServerContents = async (directory: string): Promise<ServerUpdate> => {
	const result = await invoke<ScanServerContentsResult>('scan_server_contents', { directory });
	return {
		plugins: result.plugins,
		mods: result.mods,
		worlds: result.worlds,
		datapacks: result.datapacks,
		backups: mapScannedBackups(result.backups),
		stats: {
			worlds_size_bytes: Math.max(0, Number(result.worldsSizeBytes) || 0),
			backups_size_bytes: Math.max(0, Number(result.backupsSizeBytes) || 0),
		},
	};
};
