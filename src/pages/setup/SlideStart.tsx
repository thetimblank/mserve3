import * as React from 'react';
import { SlideFrame, useSlideshow } from '@/components/slideshow';
import { Circle, CircleCheck, Plus, ServerOff } from 'lucide-react';
import { useServers } from '@/data/servers';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import EmptyState from '@/components/empty-state';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { enableServerUpnp, useSetupStartServer } from './use-setup-start-server';
import { useSetup } from './SetupContext';

/** Gets a server online before the friend test (completion is recorded there). */
export default function SlideStart() {
	const { nextSlide } = useSlideshow();
	const { servers } = useServers();
	const { start, isBusy } = useSetupStartServer();
	const { data } = useSetup();
	const navigate = useNavigate();
	// Automatic forwarding was set up on the router slide: a server that is
	// already online turns it on too (a server started below gets it on start).
	const upnpEnabledRef = React.useRef(new Set<string>());
	React.useEffect(() => {
		if (!data.upnp) return;
		for (const server of servers) {
			if (server.status !== 'online' || upnpEnabledRef.current.has(server.directory)) continue;
			upnpEnabledRef.current.add(server.directory);
			void enableServerUpnp(server);
		}
	}, [data.upnp, servers]);
	// `online` comes from the backend's lifecycle event, so this only counts a
	// server that actually finished booting.
	const onlineServersCount = servers.filter((server) => server.status === 'online').length;

	return onlineServersCount > 0 ? (
		<SlideFrame className='flex flex-col items-center text-center'>
			<CircleCheck className='size-20 text-green-500 mb-6' />
			<h1 className='text-3xl font-bold mb-2'>Your server is online</h1>
			<p className='mb-10'>Next, check that players outside your network can join.</p>
			<Button onClick={nextSlide}>Continue</Button>
		</SlideFrame>
	) : (
		<SlideFrame className='flex flex-col items-center text-center'>
			<Circle className='size-20 text-yellow-500 mb-6' />
			<h1 className='text-3xl font-bold mb-2'>Almost there</h1>
			<p className='mb-10'>Start a server to let players join!</p>
			{servers.length === 0 ? (
				<EmptyState
					icon={<ServerOff />}
					title='No servers yet'
					description='Create a server, then start it to let players join.'
					action={{ label: 'Create a server', icon: Plus, onClick: () => navigate('/servers/new') }}
				/>
			) : (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button disabled={isBusy}>Start Server</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						{servers.map((server) => (
							<DropdownMenuItem onClick={() => start(server, { upnp: data.upnp })} key={server.id}>
								Start {server.name}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</SlideFrame>
	);
}
