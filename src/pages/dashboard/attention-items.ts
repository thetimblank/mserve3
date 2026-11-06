/**
 * Builds the "Could use a look" items: servers that want action. Pure, so the
 * rules and their order are unit-tested; the cluster maps each `kind` to its
 * action (restart, wake, open a tab).
 *
 * Order: by severity (critical, then warning, then info), and within one
 * severity by rule (crashes before security, missing backups before bloat) and
 * then server order.
 */
import type { Server } from '@/data/servers';
import { formatBytes } from '@/lib/utils';

import type { DashboardStorage } from './use-dashboard-storage';

export type AttentionSeverity = 'critical' | 'warning' | 'info';

export type AttentionKind = 'crashed' | 'security' | 'no-backup' | 'stale-backup' | 'backup-bloat' | 'sleeping';

export type AttentionItem = {
	id: string;
	kind: AttentionKind;
	severity: AttentionSeverity;
	server: Server;
	/** Sentence that follows the server name, e.g. "crashed and is stopped." */
	text: string;
};

const SEVERITY_RANK: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };

export const STALE_BACKUP_MS = 7 * 24 * 60 * 60 * 1000;

/** Newest backup timestamp for a server, or null when it has none. */
const newestBackupAt = (server: Server): number | null => {
	let newest: number | null = null;
	for (const backup of server.backups) {
		const time = backup.created_at instanceof Date ? backup.created_at.getTime() : NaN;
		if (!Number.isNaN(time) && (newest === null || time > newest)) newest = time;
	}
	return newest;
};

type Input = {
	servers: Server[];
	storage?: Pick<DashboardStorage, 'byDirectory'>;
	/** Critical security finding counts, keyed by server directory. */
	securityCriticals: Map<string, number>;
	now?: number;
};

export const buildAttentionItems = ({ servers, storage, securityCriticals, now = Date.now() }: Input) => {
	const items: AttentionItem[] = [];
	const push = (server: Server, kind: AttentionKind, severity: AttentionSeverity, text: string) =>
		items.push({ id: `${kind}-${server.id}`, kind, severity, server, text });

	for (const server of servers) {
		if (server.status === 'crashed') push(server, 'crashed', 'critical', 'crashed and is stopped.');
	}

	for (const server of servers) {
		if ((securityCriticals.get(server.directory) ?? 0) > 0) {
			push(server, 'security', 'critical', 'has a critical security issue (e.g. online-mode off).');
		}
	}

	for (const server of servers) {
		if (server.worlds.length === 0) continue;
		const newest = newestBackupAt(server);
		if (newest === null) push(server, 'no-backup', 'warning', 'has no backups yet.');
		else if (now - newest > STALE_BACKUP_MS) {
			push(server, 'stale-backup', 'warning', 'has no recent backup (7+ days).');
		}
	}

	// Backup bloat: backups taking more than half of a server's footprint.
	for (const server of servers) {
		const info = storage?.byDirectory.get(server.directory);
		if (!info || info.backupsBytes <= 0) continue;
		if (info.backupsBytes > info.totalBytes * 0.5) {
			push(
				server,
				'backup-bloat',
				'warning',
				`backups use ${formatBytes(info.backupsBytes)} of ${formatBytes(info.totalBytes)}. Review retention.`,
			);
		}
	}

	for (const server of servers) {
		if (server.status === 'sleeping') push(server, 'sleeping', 'info', 'is sleeping to save resources.');
	}

	// Array.prototype.sort is stable, so rule and server order survive.
	return items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
};
