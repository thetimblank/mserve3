import { SlideFrame } from '@/components/slideshow';
import { Circle, CircleCheck, Plus, ServerOff } from 'lucide-react';
import { useServers } from '@/data/servers';
import { Button } from '@/components/ui/button';
import { Link, useNavigate } from 'react-router-dom';
import EmptyState from '@/components/empty-state';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useEffect, useRef } from 'react';
import { useSetup } from './SetupContext';
import { useUser } from '@/data/user';
import { useSetupStartServer } from './use-setup-start-server';

export default function SlideStart() {
	const { servers } = useServers();
	const { data } = useSetup();
	const { updateUserField } = useUser();
	const { start, isBusy } = useSetupStartServer();
	const navigate = useNavigate();
	const hasRecordedCompletionRef = useRef(false);
	// `online` comes from the backend's lifecycle event, so this only counts a
	// server that actually finished booting.
	const onlineServersCount = servers.filter((server) => server.status === 'online').length;

	useEffect(() => {
		if (hasRecordedCompletionRef.current) return;
		if (onlineServersCount < 1) return;

		updateUserField('initial_setup_hosting_tutorial_completed', true);
		updateUserField('completed_setup_hosting_ports', (ports) =>
			ports.includes(data.port) ? ports : [...ports, data.port],
		);
		hasRecordedCompletionRef.current = true;
	}, [data.port, onlineServersCount, updateUserField]);

	return onlineServersCount > 0 ? (
		<SlideFrame className='flex flex-col items-center text-center'>
			<CircleCheck className='size-20 text-green-500 mb-6' />
			<p className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>You&apos;re Ready</p>
			<p className='mb-10'>You and other players can now connect to your server!</p>
			<Button asChild>
				<Link to='/'>Back Home</Link>
			</Button>
		</SlideFrame>
	) : (
		<SlideFrame className='flex flex-col items-center text-center'>
			<Circle className='size-20 text-yellow-500 mb-6' />
			<p className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>Almost There</p>
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
							<DropdownMenuItem onClick={() => start(server)} key={server.id}>
								Start {server.name}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</SlideFrame>
	);
}
