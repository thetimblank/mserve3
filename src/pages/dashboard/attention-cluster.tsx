/**
 * The "Could use a look" cluster: a title card with the item count, then one
 * card per item ({@link buildAttentionItems}), tinted by severity, each with a
 * one-click action or a jump to the relevant tab. Security criticals are read
 * per server (best-effort, cached for the session).
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, CheckCircle2, CircleAlert, Moon, ShieldAlert } from 'lucide-react';

import type { Server } from '@/data/servers';
import { useServerControls } from '@/hooks/use-server-controls';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { isNetworkBackend } from '@/lib/server-security-audit';
import { countCriticalFindings, getCachedCriticalCounts } from '@/lib/server-security-scan';
import type { ManagedNetwork } from '@/lib/network-schema';
import { cn } from '@/lib/utils';

import BentoItem from './bento-item';
import ClusterTitleCard from './cluster-title-card';
import {
	buildAttentionItems,
	type AttentionItem,
	type AttentionKind,
	type AttentionSeverity,
} from './attention-items';
import type { DashboardStorage } from './use-dashboard-storage';

type Props = {
	servers: Server[];
	networks: ManagedNetwork[];
	storage?: DashboardStorage;
};

const KIND_ICON: Record<AttentionKind, React.ElementType> = {
	crashed: CircleAlert,
	security: ShieldAlert,
	'no-backup': Archive,
	'stale-backup': Archive,
	'backup-bloat': Archive,
	sleeping: Moon,
};

const SEVERITY_STYLES: Record<AttentionSeverity, { card: string; tile: string }> = {
	critical: {
		card: 'border-red-500/30 bg-red-500/10 dark:bg-red-500/15',
		tile: 'bg-red-500/15 text-red-500',
	},
	warning: {
		card: 'border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/15',
		tile: 'bg-amber-500/15 text-amber-500',
	},
	info: {
		card: 'border-indigo-400/30 bg-indigo-400/10 dark:bg-indigo-400/15',
		tile: 'bg-indigo-400/15 text-indigo-400',
	},
};

/**
 * Best-effort security scan: read each server's properties once per session (or
 * after a fix is applied) and count criticals. Keyed on the directories, not
 * `servers`, which changes on every telemetry tick.
 */
const useSecurityCriticals = (servers: Server[], networks: ManagedNetwork[]) => {
	const [criticals, setCriticals] = React.useState<Map<string, number>>(getCachedCriticalCounts);
	const serversRef = React.useRef(servers);
	serversRef.current = servers;
	const directoriesKey = servers.map((server) => server.directory).join('\n');

	React.useEffect(() => {
		let active = true;
		void (async () => {
			await Promise.all(
				serversRef.current.map((server) =>
					countCriticalFindings(server, isNetworkBackend(server.id, networks)),
				),
			);
			if (active) setCriticals(getCachedCriticalCounts());
		})();
		return () => {
			active = false;
		};
	}, [directoriesKey, networks]);

	return criticals;
};

/**
 * One attention item. Restart/Awake go through {@link useServerControls}, so the
 * button is busy-guarded and the Java runtime is resolved first, like the tiles.
 */
const AttentionCard: React.FC<{ item: AttentionItem; delay: number }> = ({ item, delay }) => {
	const navigate = useNavigate();
	const { isBusy, start } = useServerControls(item.server);
	const serverPath = `/servers/${encodeURIComponent(item.server.id)}`;

	const action = ((): { label: string; run: () => void; busy?: boolean } => {
		switch (item.kind) {
			case 'crashed':
				return { label: 'Restart', run: start, busy: isBusy };
			case 'sleeping':
				return { label: 'Awake', run: start, busy: isBusy };
			case 'security':
				return { label: 'Review', run: () => navigate(`${serverPath}/settings`) };
			case 'no-backup':
			case 'stale-backup':
			case 'backup-bloat':
				return { label: 'Backups', run: () => navigate(`${serverPath}/backups`) };
		}
	})();

	const Icon = KIND_ICON[item.kind];
	const styles = SEVERITY_STYLES[item.severity];

	return (
		<BentoItem delay={delay}>
			<Card className={cn('h-full justify-between gap-3 p-5', styles.card)}>
				<span className={cn('flex size-9 items-center justify-center rounded-lg', styles.tile)}>
					<Icon className='size-5' />
				</span>
				<p className='flex-1 text-sm'>
					<span className='font-semibold'>{item.server.name}</span> {item.text}
				</p>
				<Button
					size='sm'
					variant='secondary'
					className='self-start'
					onClick={action.run}
					disabled={action.busy}>
					{action.label}
				</Button>
			</Card>
		</BentoItem>
	);
};

const AttentionCluster: React.FC<Props> = ({ servers, networks, storage }) => {
	const securityCriticals = useSecurityCriticals(servers, networks);

	const items = React.useMemo(
		() => buildAttentionItems({ servers, storage, securityCriticals }),
		[servers, storage, securityCriticals],
	);

	const urgent = items.filter((item) => item.severity === 'critical').length;

	return (
		<>
			<ClusterTitleCard
				title='Could use a look'
				value={items.length}
				hint={
					items.length === 0 ? (
						<span className='flex items-center gap-1.5'>
							<CheckCircle2 className='size-4 text-emerald-500' />
							Everything looks healthy
						</span>
					) : urgent > 0 ? (
						`${urgent} need${urgent === 1 ? 's' : ''} action now`
					) : (
						'Nothing urgent'
					)
				}
			/>
			{items.map((item, index) => (
				<AttentionCard key={item.id} item={item} delay={0.03 + index * 0.03} />
			))}
		</>
	);
};

export default AttentionCluster;
