import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Play, Plus, Power, ServerOff } from 'lucide-react';

import { SlideFrame } from '@/components/slideshow';
import EmptyState from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { canStartStatus, type Server, useServers } from '@/data/servers';
import { useUser } from '@/data/user';
import { useServerTunnel } from '@/pages/server/hooks/use-server-tunnel';
import { TunnelStatusDetails } from '@/pages/server/tunnel-settings-section';
import { useSetupStartServer } from './use-setup-start-server';

/** The tunnel controls for one server (remounted per server so the tunnel state never leaks). */
const TunnelServerPanel: React.FC<{ server: Server }> = ({ server }) => {
	const tunnel = useServerTunnel(server.directory);
	const { start, isBusy } = useSetupStartServer();
	const { updateUserField } = useUser();
	const isShareable = tunnel.enabled && tunnel.status === 'online' && !!tunnel.address;

	React.useEffect(() => {
		if (isShareable) updateUserField('initial_setup_hosting_tutorial_completed', true);
	}, [isShareable, updateUserField]);

	if (!tunnel.enabled) {
		return (
			<div className='space-y-3'>
				<p className='text-sm text-muted-foreground'>
					Turning it on gives {server.name} a public address that stays the same across restarts.
				</p>
				<Button onClick={() => tunnel.setEnabled(true)} disabled={tunnel.busy}>
					{tunnel.busy ? <Spinner /> : <Power className='size-4' />}
					Turn on the tunnel
				</Button>
			</div>
		);
	}

	return (
		<div className='space-y-4'>
			<TunnelStatusDetails tunnel={tunnel} serverOnline={server.status === 'online'} />
			{canStartStatus(server.status) && (
				<Button onClick={() => start(server)} disabled={isBusy}>
					{isBusy ? <Spinner /> : <Play className='size-4' />}
					Start {server.name}
				</Button>
			)}
			{isShareable && (
				<p className='text-sm text-muted-foreground'>
					Share this address with your friends. They add it in Multiplayer, and it keeps working after
					restarts.
				</p>
			)}
		</div>
	);
};

export default function SlideTunnelServer() {
	const { servers } = useServers();
	const navigate = useNavigate();
	const [selectedId, setSelectedId] = React.useState<string | null>(null);
	// Default to a running server (its tunnel comes up right away), picked once
	// servers are known so later status changes never swap the selection.
	React.useEffect(() => {
		if (selectedId !== null || servers.length === 0) return;
		setSelectedId((servers.find((server) => server.status === 'online') ?? servers[0]).id);
	}, [selectedId, servers]);
	const selected = servers.find((server) => server.id === selectedId) ?? servers[0];

	return (
		<SlideFrame className='flex w-full max-w-lg flex-col items-center text-center'>
			<h1 className='mb-2 text-3xl font-bold'>Turn on the tunnel</h1>
			<p className='mb-8 text-muted-foreground'>Pick the server your friends should join.</p>

			{selected ? (
				<div className='w-full space-y-4 rounded-2xl bg-secondary/50 p-5 text-left'>
					<Select value={selected.id} onValueChange={setSelectedId}>
						<SelectTrigger className='w-full' aria-label='Server'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{servers.map((server) => (
								<SelectItem key={server.id} value={server.id}>
									{server.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<TunnelServerPanel key={selected.directory} server={selected} />
				</div>
			) : (
				<EmptyState
					icon={<ServerOff />}
					title='No servers yet'
					description='Create a server first, then come back to turn on its tunnel.'
					action={{ label: 'Create a server', icon: Plus, onClick: () => navigate('/servers/new') }}
				/>
			)}

			<Button asChild variant='secondary' className='mt-8 ml-auto'>
				<Link to='/'>Done</Link>
			</Button>
		</SlideFrame>
	);
}
