/**
 * "Needs attention" feed: a prioritized list of servers that want action —
 * recent crashes, sleeping servers, stale/missing backups, and critical security
 * findings (online-mode off / no whitelist). Each item offers a one-click action
 * or a jump to the relevant tab. Crashed/sleeping counts come straight from the
 * live server list; security criticals are read per server (best-effort, cached
 * for the session).
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { CircleAlert, Moon, Archive, ShieldAlert, CheckCircle2 } from 'lucide-react';

import { useServers, type Server } from '@/data/servers';
import { useUser } from '@/data/user';
import { useJavaRuntimes } from '@/data/java-runtimes';
import { Button } from '@/components/ui/button';
import { parsePropertiesMap } from '@/components/server-config-file-editor/properties-config';
import { auditServerProperties } from '@/lib/server-security-audit';
import { resolveAndStartServer } from '@/lib/server-actions';
import { formatBytes } from '@/pages/server/server-utils';

import DashboardSection from './dashboard-section';
import type { DashboardStorage } from './use-dashboard-storage';

type AttentionItem = {
	id: string;
	icon: React.ElementType;
	iconClass: string;
	message: React.ReactNode;
	actionLabel: string;
	onAction: () => void;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Newest backup timestamp for a server, or null when it has none. */
const newestBackupAt = (server: Server): number | null => {
	let newest: number | null = null;
	for (const backup of server.backups) {
		const time = backup.created_at instanceof Date ? backup.created_at.getTime() : NaN;
		if (!Number.isNaN(time) && (newest === null || time > newest)) newest = time;
	}
	return newest;
};

/** Session cache of per-server critical security counts, keyed by directory. */
const securityCache = new Map<string, number>();

const NeedsAttention: React.FC<{ servers: Server[]; storage?: DashboardStorage }> = ({
	servers,
	storage,
}) => {
	const navigate = useNavigate();
	const { setServerStatus, updateServerStats } = useServers();
	const { user } = useUser();
	const { runtimes } = useJavaRuntimes();
	const [securityCriticals, setSecurityCriticals] = React.useState<Map<string, number>>(
		new Map(securityCache),
	);

	const startContext = React.useMemo(
		() => ({
			runtimes,
			globalDefault: user.java_installation_default,
			setServerStatus,
			updateServerStats,
		}),
		[runtimes, user.java_installation_default, setServerStatus, updateServerStats],
	);

	// Best-effort security scan: read each non-proxy server's properties once per
	// session and count criticals (online-mode off, etc.).
	const directoriesKey = servers.map((server) => server.directory).join('\n');
	React.useEffect(() => {
		let active = true;
		void (async () => {
			const next = new Map(securityCache);
			await Promise.all(
				servers.map(async (server) => {
					if (securityCache.has(server.directory)) return;
					try {
						const result = await invoke<{ content: string }>('read_managed_server_config_file', {
							payload: { directory: server.directory, fileName: 'server.properties' },
						});
						const findings = auditServerProperties(parsePropertiesMap(result.content), {
							maxRamGb: Math.max(1, server.ram || 1),
							whitelistCount: null,
						});
						const criticals = findings.filter((finding) => finding.severity === 'critical').length;
						securityCache.set(server.directory, criticals);
						next.set(server.directory, criticals);
					} catch {
						securityCache.set(server.directory, 0);
					}
				}),
			);
			if (active) setSecurityCriticals(new Map(next));
		})();
		return () => {
			active = false;
		};
	}, [directoriesKey, servers]);

	const items = React.useMemo<AttentionItem[]>(() => {
		const list: AttentionItem[] = [];

		for (const server of servers) {
			if (server.status === 'crashed') {
				list.push({
					id: `crash-${server.id}`,
					icon: CircleAlert,
					iconClass: 'text-destructive',
					message: (
						<span>
							<span className='font-medium'>{server.name}</span> crashed and is stopped.
						</span>
					),
					actionLabel: 'Restart',
					onAction: () => void resolveAndStartServer(server, startContext),
				});
			} else if (server.status === 'sleeping') {
				list.push({
					id: `sleep-${server.id}`,
					icon: Moon,
					iconClass: 'text-indigo-400',
					message: (
						<span>
							<span className='font-medium'>{server.name}</span> is sleeping to save resources.
						</span>
					),
					actionLabel: 'Awake',
					onAction: () => void resolveAndStartServer(server, startContext),
				});
			}
		}

		for (const server of servers) {
			const criticals = securityCriticals.get(server.directory) ?? 0;
			if (criticals > 0) {
				list.push({
					id: `sec-${server.id}`,
					icon: ShieldAlert,
					iconClass: 'text-destructive',
					message: (
						<span>
							<span className='font-medium'>{server.name}</span> has a critical security issue (e.g.
							online-mode off).
						</span>
					),
					actionLabel: 'Review',
					onAction: () => navigate(`/servers/${encodeURIComponent(server.id)}/settings`),
				});
			}
		}

		for (const server of servers) {
			if (server.worlds.length === 0) continue;
			const newest = newestBackupAt(server);
			const stale = newest === null || Date.now() - newest > SEVEN_DAYS_MS;
			if (stale) {
				list.push({
					id: `backup-${server.id}`,
					icon: Archive,
					iconClass: 'text-amber-500',
					message: (
						<span>
							<span className='font-medium'>{server.name}</span>{' '}
							{newest === null ? 'has no backups yet.' : 'has no recent backup (7+ days).'}
						</span>
					),
					actionLabel: 'Backups',
					onAction: () => navigate(`/servers/${encodeURIComponent(server.id)}/backups`),
				});
			}
		}

		// Backup bloat: backups eating more than half a server's footprint (moved
		// here from the storage card to keep that card minimal).
		for (const server of servers) {
			const info = storage?.byDirectory.get(server.directory);
			if (!info || info.backupsBytes <= 0) continue;
			if (info.backupsBytes > info.totalBytes * 0.5) {
				list.push({
					id: `bloat-${server.id}`,
					icon: Archive,
					iconClass: 'text-amber-500',
					message: (
						<span>
							<span className='font-medium'>{server.name}</span> backups are{' '}
							{formatBytes(info.backupsBytes)} of {formatBytes(info.totalBytes)} — review retention.
						</span>
					),
					actionLabel: 'Backups',
					onAction: () => navigate(`/servers/${encodeURIComponent(server.id)}/backups`),
				});
			}
		}

		return list;
	}, [servers, storage, securityCriticals, startContext, navigate]);

	return (
		<DashboardSection className='h-full' title='Could use a look'>
			{items.length === 0 ? (
				<div className='flex items-center gap-2 text-sm text-muted-foreground'>
					<CheckCircle2 className='size-4 text-emerald-500' />
					Everything looks healthy.
				</div>
			) : (
				<div className='space-y-2'>
					{items.map((item) => {
						const Icon = item.icon;
						return (
							<div
								key={item.id}
								className='flex items-center gap-3 rounded-md bg-background/40 px-3 py-2'>
								<Icon className={`size-4 shrink-0 ${item.iconClass}`} />
								<p className='min-w-0 flex-1 text-sm'>{item.message}</p>
								<Button size='sm' variant='secondary' className='shrink-0' onClick={item.onAction}>
									{item.actionLabel}
								</Button>
							</div>
						);
					})}
				</div>
			)}
		</DashboardSection>
	);
};

export default NeedsAttention;
