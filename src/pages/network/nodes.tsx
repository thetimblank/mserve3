import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Boxes, Waypoints } from 'lucide-react';
import clsx from 'clsx';

import type { Server, ServerStatus } from '@/data/servers';
import type { NetworkMember } from '@/lib/network-schema';
import { getProviderDisplayName } from '@/lib/server-provider';
import type { ProviderKind } from '@/lib/mserve-schema';

export interface ProxyNodeData extends Record<string, unknown> {
	server: Server;
	memberCount: number;
	warningCount: number;
	bind: string;
	selected: boolean;
}

export interface BackendNodeData extends Record<string, unknown> {
	server: Server;
	member: NetworkMember;
	kind: ProviderKind;
	warning?: string;
	selected: boolean;
}

const STATUS_DOT: Record<ServerStatus, string> = {
	online: 'bg-emerald-500',
	offline: 'bg-muted-foreground/40',
	starting: 'bg-amber-500',
	closing: 'bg-amber-500',
};

const StatusDot = ({ status }: { status: ServerStatus }) => (
	<span className='inline-flex items-center gap-1.5 text-xs capitalize text-muted-foreground'>
		<span className={clsx('size-2 rounded-full', STATUS_DOT[status])} />
		{status}
	</span>
);

const handleClass = '!size-2.5 !border-2 !border-background !bg-primary';

export const ProxyNode = ({ data }: NodeProps) => {
	const { server, memberCount, warningCount, bind, selected } = data as ProxyNodeData;

	return (
		<div
			style={{ width: 248 }}
			className={clsx(
				'rounded-2xl border-2 bg-card p-4 shadow-lg transition-colors',
				selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
			)}>
			<div className='flex items-center gap-2'>
				<span className='flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary'>
					<Waypoints className='size-5' />
				</span>
				<div className='min-w-0 flex-1'>
					<p className='truncate font-bold leading-tight'>{server.name}</p>
					<p className='text-xs text-muted-foreground'>
						{getProviderDisplayName(server.provider.name)} proxy
					</p>
				</div>
			</div>

			<div className='mt-3 flex items-center justify-between'>
				<StatusDot status={server.status} />
				<span className='rounded-md bg-muted px-2 py-0.5 font-mono text-xs'>{bind}</span>
			</div>

			<div className='mt-2 flex items-center justify-between text-xs text-muted-foreground'>
				<span>
					{memberCount} backend{memberCount === 1 ? '' : 's'}
				</span>
				{warningCount > 0 && (
					<span className='inline-flex items-center gap-1 text-amber-500'>
						<AlertTriangle className='size-3.5' /> {warningCount}
					</span>
				)}
			</div>

			<Handle type='source' position={Position.Right} className={handleClass} />
		</div>
	);
};

export const BackendNode = ({ data }: NodeProps) => {
	const { server, member, kind, warning, selected } = data as BackendNodeData;

	return (
		<div
			style={{ width: 232 }}
			className={clsx(
				'rounded-2xl border-2 bg-card p-4 shadow-md transition-colors',
				selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
				warning && 'border-amber-500/60',
			)}>
			<Handle type='target' position={Position.Left} className={handleClass} />

			<div className='flex items-center gap-2'>
				<span className='flex size-9 items-center justify-center rounded-xl bg-muted text-foreground'>
					<Boxes className='size-5' />
				</span>
				<div className='min-w-0 flex-1'>
					<p className='truncate font-bold leading-tight'>{server.name}</p>
					<p className='truncate text-xs text-muted-foreground'>
						{getProviderDisplayName(server.provider.name)}
						{server.provider.minecraft_version ? ` · ${server.provider.minecraft_version}` : ''}
					</p>
				</div>
			</div>

			<div className='mt-3 flex items-center justify-between'>
				<StatusDot status={server.status} />
				<span className='rounded-md bg-muted px-2 py-0.5 font-mono text-xs'>
					{member.host}:{member.port}
				</span>
			</div>

			<div className='mt-2 flex flex-wrap items-center gap-1.5'>
				<span className='rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary'>
					{member.alias}
				</span>
				{member.inTry && (
					<span className='rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground'>
						try #{member.tryIndex + 1}
					</span>
				)}
				{kind !== 'plugin' && (
					<span className='rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400'>
						no forwarding
					</span>
				)}
			</div>

			{warning && (
				<p className='mt-2 flex items-start gap-1 text-[11px] leading-snug text-amber-600 dark:text-amber-400'>
					<AlertTriangle className='mt-0.5 size-3 shrink-0' />
					<span>{warning}</span>
				</p>
			)}
		</div>
	);
};

export const networkNodeTypes = {
	proxy: ProxyNode,
	backend: BackendNode,
};
