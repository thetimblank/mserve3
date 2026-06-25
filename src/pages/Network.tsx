import React from 'react';
import { useLocation } from 'react-router-dom';
import { m } from 'motion/react';
import { ChevronDown, Loader2, Play, Plus, RotateCcw, Network, Square, UploadCloud } from 'lucide-react';
import clsx from 'clsx';

import { useServers } from '@/data/servers';
import { useNetworks } from '@/data/networks';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { diagnoseNetwork, networkHasBlockingErrors } from '@/lib/network-config-engine';
import { getNetworkServerIds, type NetworkNodePosition } from '@/lib/network-schema';

import { NetworkCanvas } from './network/NetworkCanvas';
import { NetworkInspector } from './network/NetworkInspector';
import { ApplyChangesDrawer } from './network/ApplyChangesDrawer';
import { useNetworkTelemetry } from './network/use-network-telemetry';
import { useNetworkOrchestration, type OrchestrationMode } from './network/use-network-orchestration';

const RunSubmenu: React.FC<{
	icon: React.ReactNode;
	label: string;
	onSelect: (mode: OrchestrationMode) => void;
}> = ({ icon, label, onSelect }) => (
	<DropdownMenuSub>
		<DropdownMenuSubTrigger>
			{icon} {label}
		</DropdownMenuSubTrigger>
		<DropdownMenuSubContent>
			<DropdownMenuItem onSelect={() => onSelect('sequential')}>
				Sequential (one at a time)
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => onSelect('staged')}>
				Staged (backends, then proxy)
			</DropdownMenuItem>
		</DropdownMenuSubContent>
	</DropdownMenuSub>
);

const NetworkRunMenu: React.FC<{
	busy: boolean;
	disabled: boolean;
	onStart: (mode: OrchestrationMode) => void;
	onStop: (mode: OrchestrationMode) => void;
	onRestart: (mode: OrchestrationMode) => void;
}> = ({ busy, disabled, onStart, onStop, onRestart }) => (
	<DropdownMenu>
		<DropdownMenuTrigger asChild>
			<Button variant='outline' disabled={busy || disabled} title='Run the whole network'>
				{busy ? <Loader2 className='animate-spin' /> : <Play />} Run <ChevronDown />
			</Button>
		</DropdownMenuTrigger>
		<DropdownMenuContent align='end' className='w-56'>
			<RunSubmenu icon={<Play />} label='Start' onSelect={onStart} />
			<RunSubmenu icon={<Square />} label='Stop' onSelect={onStop} />
			<RunSubmenu icon={<RotateCcw />} label='Restart' onSelect={onRestart} />
		</DropdownMenuContent>
	</DropdownMenu>
);

const NetworkPage: React.FC = () => {
	const { servers, isReady: serversReady, updateServerStats } = useServers();
	const { networks, isReady: networksReady, createNetwork, updateNetwork, removeNetwork } = useNetworks();

	// A dashboard network shortcut passes the target network id via router state.
	const location = useLocation();
	const requestedNetworkId =
		(location.state as { networkId?: string } | null)?.networkId ?? null;

	const [activeNetworkId, setActiveNetworkId] = React.useState<string | null>(requestedNetworkId);
	const [selectedServerId, setSelectedServerId] = React.useState<string | null>(null);
	const [applyOpen, setApplyOpen] = React.useState(false);

	// Honor a network id requested via navigation (dashboard shortcut) once it loads.
	React.useEffect(() => {
		if (requestedNetworkId && networks.some((network) => network.id === requestedNetworkId)) {
			setActiveNetworkId(requestedNetworkId);
		}
	}, [requestedNetworkId, networks]);

	// Keep an active network selected as the list changes.
	React.useEffect(() => {
		if (networks.length === 0) {
			if (activeNetworkId !== null) setActiveNetworkId(null);
			return;
		}
		if (!activeNetworkId || !networks.some((network) => network.id === activeNetworkId)) {
			setActiveNetworkId(networks[0].id);
		}
	}, [networks, activeNetworkId]);

	// Reconcile network references against the live server list (prune deleted servers).
	React.useEffect(() => {
		if (!serversReady || !networksReady) return;
		const ids = new Set(servers.map((server) => server.id));
		for (const network of networks) {
			const validMembers = network.members.filter((member) => ids.has(member.serverId));
			const proxyValid = network.proxyServerId ? ids.has(network.proxyServerId) : true;
			if (validMembers.length !== network.members.length || !proxyValid) {
				updateNetwork(network.id, {
					members: validMembers,
					proxyServerId: proxyValid ? network.proxyServerId : null,
				});
			}
		}
	}, [servers, networks, serversReady, networksReady, updateNetwork]);

	const activeNetwork = React.useMemo(
		() => networks.find((network) => network.id === activeNetworkId) ?? null,
		[networks, activeNetworkId],
	);

	const diagnostics = React.useMemo(
		() => (activeNetwork ? diagnoseNetwork(activeNetwork, servers, networks) : []),
		[activeNetwork, servers, networks],
	);

	const hasBlockingErrors = networkHasBlockingErrors(diagnostics);

	// Keep node metrics live while the page is open, and drive whole-network runs.
	useNetworkTelemetry(activeNetwork, servers);
	const { busy, progress, startNetwork, stopNetwork, restartNetwork } = useNetworkOrchestration(
		activeNetwork,
		servers,
	);

	const networkServerIds = React.useMemo(
		() => (activeNetwork ? getNetworkServerIds(activeNetwork) : []),
		[activeNetwork],
	);
	const onlineCount = React.useMemo(
		() =>
			servers.filter((server) => networkServerIds.includes(server.id) && server.status === 'online')
				.length,
		[servers, networkServerIds],
	);
	const progressServerName = progress?.currentServerId
		? servers.find((server) => server.id === progress.currentServerId)?.name
		: undefined;

	const handleRemoveMember = React.useCallback(
		(serverId: string) => {
			if (!activeNetwork) return;
			updateNetwork(activeNetwork.id, (network) => ({
				...network,
				members: network.members.filter((member) => member.serverId !== serverId),
			}));
		},
		[activeNetwork, updateNetwork],
	);

	const handleRemoveProxy = React.useCallback(() => {
		if (!activeNetwork) return;
		updateNetwork(activeNetwork.id, { proxyServerId: null });
	}, [activeNetwork, updateNetwork]);

	const handleCreateNetwork = () => {
		const id = createNetwork(`Network ${networks.length + 1}`);
		setActiveNetworkId(id);
	};

	const handleLayoutChange = React.useCallback(
		(serverId: string, position: NetworkNodePosition) => {
			if (!activeNetwork) return;
			updateNetwork(activeNetwork.id, (network) => ({
				...network,
				layout: { ...network.layout, [serverId]: position },
			}));
		},
		[activeNetwork, updateNetwork],
	);

	const handleApplied = React.useCallback(() => {
		// Server config files changed on disk; nudge telemetry to re-read on next poll.
		for (const server of servers) {
			updateServerStats(server.id, {});
		}
	}, [servers, updateServerStats]);

	return (
		<main className='flex h-full w-full flex-col overflow-hidden px-8 py-10'>
			<div className='flex items-start justify-between gap-4'>
				<div>
					<m.h1
						initial={{ y: 30, opacity: 0 }}
						animate={{ y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
						className='flex items-center gap-3 text-3xl font-black'>
						<Network className='size-8 text-primary' />
						Server Network <span className='text-mserve-accent'>(BETA)</span>
					</m.h1>
					<p className='mt-1 text-sm text-muted-foreground'>
						Connect backend servers to a Velocity proxy. mserve assigns ports and wires modern
						forwarding automatically.
					</p>
				</div>

				<div className='flex shrink-0 items-center gap-2'>
					{activeNetwork && (
						<span className='mr-1 inline-flex items-center gap-2 text-xs text-muted-foreground'>
							{busy && <Loader2 className='size-3.5 animate-spin' />}
							{busy
								? `${progress?.action === 'stop' ? 'Stopping' : progress?.action === 'restart' ? 'Restarting' : 'Starting'}${
										progressServerName ? ` ${progressServerName}` : ''
									}…`
								: `${onlineCount}/${networkServerIds.length} online`}
						</span>
					)}
					<Button variant='outline' onClick={handleCreateNetwork}>
						<Plus /> New network
					</Button>
					{activeNetwork && (
						<NetworkRunMenu
							busy={busy}
							disabled={!activeNetwork.proxyServerId}
							onStart={startNetwork}
							onStop={stopNetwork}
							onRestart={restartNetwork}
						/>
					)}
					{activeNetwork && (
						<Button
							onClick={() => setApplyOpen(true)}
							disabled={hasBlockingErrors || !activeNetwork.proxyServerId}
							title={
								hasBlockingErrors
									? 'Resolve the errors below before applying'
									: 'Review and apply config changes'
							}>
							<UploadCloud /> Apply changes
						</Button>
					)}
				</div>
			</div>

			{networks.length > 1 && (
				<div className='mt-4 flex flex-wrap gap-1.5'>
					{networks.map((network) => (
						<button
							key={network.id}
							onClick={() => setActiveNetworkId(network.id)}
							className={clsx(
								'rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
								network.id === activeNetworkId
									? 'bg-accent text-accent-foreground'
									: 'text-muted-foreground hover:bg-muted',
							)}>
							{network.name}
						</button>
					))}
				</div>
			)}

			{!networksReady ? (
				<div className='flex flex-1 items-center justify-center text-sm text-muted-foreground'>
					Loading networks…
				</div>
			) : networks.length === 0 ? (
				<div className='flex flex-1 items-center justify-center'>
					<m.div
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
						className='flex flex-col items-center text-center'>
						<Network className='size-20 mb-6' />
						<h1 className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>
							Create your first network
						</h1>
						<p className='mb-2'>Group servers behind a Proxy to build a multi-server network.</p>
						<p className='text-mserve-accent mb-4'>
							Please note this is a beta feature and may not work as intended.
						</p>

						<Button onClick={handleCreateNetwork}>
							<Plus /> New network
						</Button>
					</m.div>
				</div>
			) : activeNetwork ? (
				<div className='mt-4 flex min-h-0 flex-1 gap-4'>
					<div className='relative min-h-0 flex-1 overflow-hidden rounded-2xl border bg-muted/10'>
						<NetworkCanvas
							network={activeNetwork}
							servers={servers}
							diagnostics={diagnostics}
							selectedServerId={selectedServerId}
							onSelectServer={setSelectedServerId}
							onLayoutChange={handleLayoutChange}
							onRemoveMember={handleRemoveMember}
							onRemoveProxy={handleRemoveProxy}
						/>
					</div>
					<aside className='flex w-90 shrink-0 flex-col overflow-hidden rounded-2xl border bg-background p-3'>
						<NetworkInspector
							network={activeNetwork}
							servers={servers}
							diagnostics={diagnostics}
							onUpdate={(update) => updateNetwork(activeNetwork.id, update)}
							onDelete={() => removeNetwork(activeNetwork.id)}
						/>
					</aside>
				</div>
			) : null}

			{activeNetwork && (
				<ApplyChangesDrawer
					open={applyOpen}
					onOpenChange={setApplyOpen}
					network={activeNetwork}
					servers={servers}
					onApplied={handleApplied}
				/>
			)}
		</main>
	);
};

export default NetworkPage;
