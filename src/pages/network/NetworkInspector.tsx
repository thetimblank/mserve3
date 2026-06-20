import React from 'react';
import { toast } from 'sonner';
import {
	AlertCircle,
	AlertTriangle,
	ArrowDown,
	ArrowUp,
	Copy,
	Plus,
	RefreshCw,
	ShieldCheck,
	Trash2,
} from 'lucide-react';
import clsx from 'clsx';

import type { Server } from '@/data/servers';
import type { NetworkUpdate } from '@/data/networks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { resolveProviderKind } from '@/lib/server-provider-capabilities';
import { getProviderDisplayName } from '@/lib/server-provider';
import {
	DEFAULT_BACKEND_HOST,
	generateForwardingSecret,
	sanitizeNetworkAlias,
	type ManagedNetwork,
	type NetworkMember,
} from '@/lib/network-schema';
import type { NetworkDiagnostic } from '@/lib/network-config-engine';

interface NetworkInspectorProps {
	network: ManagedNetwork;
	servers: Server[];
	diagnostics: NetworkDiagnostic[];
	onUpdate: (update: NetworkUpdate) => void;
	onDelete: () => void;
}

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<p className='mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground'>{children}</p>
);

const MemberRow: React.FC<{
	member: NetworkMember;
	server: Server | undefined;
	index: number;
	total: number;
	onChange: (next: Partial<NetworkMember>) => void;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
}> = ({ member, server, index, total, onChange, onMove, onRemove }) => {
	const [alias, setAlias] = React.useState(member.alias);
	const [host, setHost] = React.useState(member.host);

	React.useEffect(() => setAlias(member.alias), [member.alias]);
	React.useEffect(() => setHost(member.host), [member.host]);

	return (
		<div className='rounded-xl border bg-card p-3'>
			<div className='flex items-center justify-between gap-2'>
				<p className='min-w-0 flex-1 truncate text-sm font-semibold'>
					{server?.name ?? 'Missing server'}
				</p>
				<span className='shrink-0 font-mono text-xs text-muted-foreground'>:{member.port}</span>
			</div>

			<div className='mt-2 grid grid-cols-2 gap-2'>
				<label className='flex flex-col gap-1'>
					<span className='text-[11px] text-muted-foreground'>Alias</span>
					<Input
						value={alias}
						onChange={(event) => setAlias(event.target.value)}
						onBlur={() => {
							const sanitized = sanitizeNetworkAlias(alias);
							setAlias(sanitized);
							if (sanitized !== member.alias) onChange({ alias: sanitized });
						}}
						className='h-8'
					/>
				</label>
				<label className='flex flex-col gap-1'>
					<span className='text-[11px] text-muted-foreground'>Host</span>
					<Input
						value={host}
						onChange={(event) => setHost(event.target.value)}
						onBlur={() => {
							const trimmed = host.trim() || DEFAULT_BACKEND_HOST;
							setHost(trimmed);
							if (trimmed !== member.host) onChange({ host: trimmed });
						}}
						className='h-8'
					/>
				</label>
			</div>

			<div className='mt-2 flex items-center justify-between'>
				<label className='flex cursor-pointer items-center gap-2 text-xs text-muted-foreground'>
					<Checkbox
						checked={member.inTry}
						onCheckedChange={(checked) => onChange({ inTry: checked === true })}
					/>
					In fallback (try)
				</label>
				<div className='flex items-center gap-1'>
					<Button
						variant='ghost'
						size='icon-xs'
						disabled={index === 0}
						onClick={() => onMove(-1)}
						title='Move up'>
						<ArrowUp />
					</Button>
					<Button
						variant='ghost'
						size='icon-xs'
						disabled={index === total - 1}
						onClick={() => onMove(1)}
						title='Move down'>
						<ArrowDown />
					</Button>
					<Button
						variant='ghost'
						size='icon-xs'
						className='text-destructive'
						onClick={onRemove}
						title='Remove from network'>
						<Trash2 />
					</Button>
				</div>
			</div>
		</div>
	);
};

export const NetworkInspector: React.FC<NetworkInspectorProps> = ({
	network,
	servers,
	diagnostics,
	onUpdate,
	onDelete,
}) => {
	const byId = React.useMemo(() => new Map(servers.map((server) => [server.id, server])), [servers]);
	const [name, setName] = React.useState(network.name);
	React.useEffect(() => setName(network.name), [network.name]);

	const proxies = React.useMemo(
		() => servers.filter((server) => resolveProviderKind(server.provider) === 'proxy'),
		[servers],
	);

	const memberIds = React.useMemo(
		() => new Set(network.members.map((member) => member.serverId)),
		[network.members],
	);

	// Any server that isn't the chosen proxy and isn't already a member can be a
	// backend. We deliberately do NOT filter on provider kind — imported or
	// unrecognized providers must still be selectable. Non-Paper backends just
	// get a "no auto-forwarding" warning later.
	const candidateBackends = React.useMemo(
		() => servers.filter((server) => server.id !== network.proxyServerId && !memberIds.has(server.id)),
		[servers, network.proxyServerId, memberIds],
	);

	const orderedMembers = React.useMemo(
		() => [...network.members].sort((left, right) => left.tryIndex - right.tryIndex),
		[network.members],
	);

	const setMembers = (members: NetworkMember[]) => onUpdate({ members });

	const updateMember = (serverId: string, next: Partial<NetworkMember>) =>
		setMembers(network.members.map((member) => (member.serverId === serverId ? { ...member, ...next } : member)));

	const moveMember = (serverId: string, direction: -1 | 1) => {
		const ordered = [...orderedMembers];
		const index = ordered.findIndex((member) => member.serverId === serverId);
		const target = index + direction;
		if (index < 0 || target < 0 || target >= ordered.length) return;
		[ordered[index], ordered[target]] = [ordered[target], ordered[index]];
		setMembers(ordered.map((member, position) => ({ ...member, tryIndex: position })));
	};

	const addBackend = (server: Server) => {
		const member: NetworkMember = {
			serverId: server.id,
			alias: sanitizeNetworkAlias(server.name),
			host: DEFAULT_BACKEND_HOST,
			port: 0,
			inTry: true,
			tryIndex: network.members.length,
		};
		setMembers([...network.members, member]);
	};

	const regenerateSecret = () => {
		onUpdate({ forwarding: { mode: 'modern', secret: generateForwardingSecret() } });
		toast.success('Generated a new forwarding secret.');
	};

	const copySecret = async () => {
		try {
			await navigator.clipboard.writeText(network.forwarding.secret);
			toast.success('Forwarding secret copied.');
		} catch {
			toast.error('Could not copy to clipboard.');
		}
	};

	return (
		<div className='flex h-full flex-col gap-5 overflow-y-auto p-1'>
			<div>
				<SectionLabel>Network name</SectionLabel>
				<Input
					value={name}
					onChange={(event) => setName(event.target.value)}
					onBlur={() => {
						const trimmed = name.trim();
						if (trimmed && trimmed !== network.name) onUpdate({ name: trimmed });
						else setName(network.name);
					}}
				/>
			</div>

			<div>
				<SectionLabel>Proxy</SectionLabel>
				{proxies.length === 0 ? (
					<p className='rounded-lg border border-dashed p-3 text-xs text-muted-foreground'>
						No Velocity proxy servers found. Create one from the Create Server flow to route a network.
					</p>
				) : (
					<Select
						value={network.proxyServerId ?? undefined}
						onValueChange={(value) => onUpdate({ proxyServerId: value })}>
						<SelectTrigger className='w-full'>
							<SelectValue placeholder='Choose a proxy server' />
						</SelectTrigger>
						<SelectContent>
							{proxies.map((proxy) => (
								<SelectItem key={proxy.id} value={proxy.id}>
									{proxy.name} · {getProviderDisplayName(proxy.provider.name)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
			</div>

			<div>
				<div className='mb-2 flex items-center justify-between'>
					<SectionLabel>Backends ({network.members.length})</SectionLabel>
					<span className='text-[11px] text-muted-foreground'>base port {network.basePort}</span>
				</div>

				<div className='flex flex-col gap-2'>
					{orderedMembers.map((member, index) => (
						<MemberRow
							key={member.serverId}
							member={member}
							server={byId.get(member.serverId)}
							index={index}
							total={orderedMembers.length}
							onChange={(next) => updateMember(member.serverId, next)}
							onMove={(direction) => moveMember(member.serverId, direction)}
							onRemove={() => setMembers(network.members.filter((entry) => entry.serverId !== member.serverId))}
						/>
					))}
					{network.members.length === 0 && (
						<p className='rounded-lg border border-dashed p-3 text-xs text-muted-foreground'>
							No backends yet. Add a server below (Paper/Folia get automatic forwarding).
						</p>
					)}
				</div>

				<div className='mt-2'>
					{candidateBackends.length > 0 ? (
						<div className='flex flex-col gap-1.5'>
							<p className='text-[11px] text-muted-foreground'>Add a backend</p>
							<div className='flex flex-wrap gap-1.5'>
								{candidateBackends.map((server) => {
									const kind = resolveProviderKind(server.provider);
									return (
										<button
											key={server.id}
											type='button'
											onClick={() => addBackend(server)}
											className='inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted'
											title={`Add ${server.name} as a backend`}>
											<Plus className='size-3.5' />
											{server.name}
											<span className='text-muted-foreground'>
												· {getProviderDisplayName(server.provider.name)}
											</span>
											{kind === 'proxy' && (
												<span className='rounded bg-amber-500/15 px-1 text-[10px] text-amber-600 dark:text-amber-400'>
													proxy
												</span>
											)}
										</button>
									);
								})}
							</div>
						</div>
					) : (
						<p className='rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground'>
							{servers.length <= (network.proxyServerId ? 1 : 0) + network.members.length
								? 'No other servers available to add. Create a server from the Create Server flow.'
								: 'All eligible servers are already in this network.'}
						</p>
					)}
				</div>
			</div>

			<div>
				<SectionLabel>Modern forwarding secret</SectionLabel>
				<div className='flex items-center gap-2'>
					<Input readOnly value={network.forwarding.secret} className='font-mono text-xs' />
					<Button variant='outline' size='icon' onClick={copySecret} title='Copy secret'>
						<Copy />
					</Button>
					<Button variant='outline' size='icon' onClick={regenerateSecret} title='Regenerate secret'>
						<RefreshCw />
					</Button>
				</div>
				<p className='mt-1 flex items-center gap-1 text-[11px] text-muted-foreground'>
					<ShieldCheck className='size-3' /> Synced to the proxy and every Paper/Folia backend on apply.
				</p>
			</div>

			{diagnostics.length > 0 && (
				<div>
					<SectionLabel>Diagnostics</SectionLabel>
					<div className='flex flex-col gap-1.5'>
						{diagnostics.map((diagnostic, index) => (
							<div
								key={index}
								className={clsx(
									'flex items-start gap-2 rounded-lg border p-2 text-xs',
									diagnostic.level === 'error'
										? 'border-destructive/40 bg-destructive/10 text-destructive'
										: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
								)}>
								{diagnostic.level === 'error' ? (
									<AlertCircle className='mt-0.5 size-3.5 shrink-0' />
								) : (
									<AlertTriangle className='mt-0.5 size-3.5 shrink-0' />
								)}
								<span>{diagnostic.message}</span>
							</div>
						))}
					</div>
				</div>
			)}

			<div className='mt-auto pt-2'>
				<Button variant='destructive-secondary' className='w-full' onClick={onDelete}>
					<Trash2 /> Delete network
				</Button>
			</div>
		</div>
	);
};
