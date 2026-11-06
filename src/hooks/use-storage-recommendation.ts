import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useServers } from '@/data/servers';
import {
	computeStorageRecommendation,
	type DiskSpace,
	type OtherServerBackups,
	type StorageRecommendation,
} from '@/lib/storage-recommendation';

/** Size and free space of the drive holding `path` (or its nearest existing parent). */
export const getDiskSpace = (path: string) => invoke<DiskSpace>('get_disk_space', { path });

/** Quiet time after the last change to `path` before its drive is read. */
const DISK_LOOKUP_DELAY_MS = 300;

// A server folder's drive doesn't change while mserve runs, so each folder's
// mount point is looked up once per session.
const mountPointCache = new Map<string, Promise<string | null>>();

const resolveMountPoint = (directory: string) => {
	let pending = mountPointCache.get(directory);
	if (!pending) {
		pending = getDiskSpace(directory)
			.then((disk) => disk.mountPoint)
			.catch(() => {
				mountPointCache.delete(directory);
				return null;
			});
		mountPointCache.set(directory, pending);
	}
	return pending;
};

const normalizeDirectory = (value: string) => {
	const trimmed = value.trim().replace(/[\\/]+$/, '');
	return /^[a-z]:/i.test(trimmed) || trimmed.includes('\\') ? trimmed.toLowerCase() : trimmed;
};

export type StorageRecommendationState = {
	disk: DiskSpace | null;
	/** `null` while loading, or when the drive couldn't be read. */
	recommendation: StorageRecommendation | null;
	/** The drive couldn't be read (or there is no folder yet). */
	isUnavailable: boolean;
};

/**
 * The recommended backup storage limit for a server folder. `path` is the
 * server's directory, or for a server that doesn't exist yet, the folder it
 * will be created in. A known server at `path` is "this server": its current
 * backups count toward its own limit, and the others on the drive are reserved.
 */
export function useStorageRecommendation(path: string): StorageRecommendationState {
	const { servers } = useServers();
	const target = path.trim();
	const [disk, setDisk] = React.useState<DiskSpace | null>(null);
	const [isUnavailable, setIsUnavailable] = React.useState(false);
	const [mounts, setMounts] = React.useState<{ key: string; byDirectory: Record<string, string> }>({
		key: '',
		byDirectory: {},
	});

	React.useEffect(() => {
		setDisk(null);
		setIsUnavailable(!target);
		if (!target) return;
		let active = true;
		// `path` can be a folder field being typed in (the repair dialog), so
		// the drive is only read once it settles.
		const timer = window.setTimeout(() => {
			getDiskSpace(target)
				.then((next) => {
					if (active) setDisk(next);
				})
				.catch(() => {
					if (active) setIsUnavailable(true);
				});
		}, DISK_LOOKUP_DELAY_MS);
		return () => {
			active = false;
			window.clearTimeout(timer);
		};
	}, [target]);

	const targetKey = normalizeDirectory(target);
	const self = servers.find((server) => normalizeDirectory(server.directory) === targetKey);
	// Only servers with automatic backups grow their backups on their own.
	const others = servers.filter(
		(server) => server !== self && server.directory.trim() && server.auto_backup.length > 0,
	);
	const othersKey = others.map((server) => server.directory).join('\n');

	React.useEffect(() => {
		let active = true;
		const directories = othersKey ? othersKey.split('\n') : [];
		void Promise.all(
			directories.map(async (directory) => [directory, await resolveMountPoint(directory)] as const),
		).then((entries) => {
			if (!active) return;
			const byDirectory: Record<string, string> = {};
			for (const [directory, mountPoint] of entries) {
				if (mountPoint) byDirectory[directory] = mountPoint;
			}
			setMounts({ key: othersKey, byDirectory });
		});
		return () => {
			active = false;
		};
	}, [othersKey]);

	const isReady = disk !== null && mounts.key === othersKey;
	const ownBackupsBytes = self?.stats.backups_size_bytes ?? 0;
	const otherServers: OtherServerBackups[] = others.flatMap((server) => {
		const mountPoint = mounts.byDirectory[server.directory];
		if (!mountPoint) return [];
		return [
			{
				mountPoint,
				storageLimitGb: server.storage_limit,
				backupsBytes: server.stats.backups_size_bytes,
			},
		];
	});

	return {
		disk,
		recommendation: isReady ? computeStorageRecommendation({ disk, otherServers, ownBackupsBytes }) : null,
		isUnavailable,
	};
}
