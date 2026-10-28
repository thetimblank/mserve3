import { SlideFrame } from '@/components/slideshow';
import { Circle, CircleCheck } from 'lucide-react';
import { Server, useServers } from '@/data/servers';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useEffect, useRef, useState } from 'react';
import { useSetup } from './SetupContext';
import { useUser } from '@/data/user';
import { useServerJavaResolver } from '@/data/java-download';
import { startServer } from '@/lib/server-controls';

export default function Slide4() {
	const { servers, setServerStatus, updateServerStats } = useServers();
	const { data } = useSetup();
	const { updateUserField } = useUser();
	const resolveServerJava = useServerJavaResolver();
	const [isBusy, setIsBusy] = useState(false);
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

	const handleStart = async (server: Server) => {
		if (isBusy) return;
		setIsBusy(true);
		try {
			const javaExecutable = await resolveServerJava(server);
			if (!javaExecutable) return;
			await startServer({ server, javaExecutable, setServerStatus, updateServerStats });
		} finally {
			setIsBusy(false);
		}
	};

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
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button>Start Server</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					{servers.map((server, i) => (
						<DropdownMenuItem onClick={() => handleStart(server)} key={i}>
							Start {server.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</SlideFrame>
	);
}
