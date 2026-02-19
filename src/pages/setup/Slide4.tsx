import { m } from 'motion/react';
import { Circle, CircleCheck } from 'lucide-react';
import { createServerId, Server, useServers } from '@/data/servers';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSetup } from './SetupContext';
import { useUser } from '@/data/user';

export default function Slide4() {
	const { servers, setServerStatus, updateServerStats } = useServers();
	const { data } = useSetup();
	const { updateUserField } = useUser();
	const [isBusy, setIsBusy] = useState(false);
	const hasRecordedCompletionRef = useRef(false);
	const onlineServersCount = servers.filter((server) => server.status === 'online').length;

	useEffect(() => {
		if (hasRecordedCompletionRef.current) return;
		if (onlineServersCount < 1) return;

		updateUserField('initial_setup_hosting_tutorial_completed', true);
		updateUserField('completed_setup_hosting_ports', (ports) => [...ports, data.port]);
		hasRecordedCompletionRef.current = true;
	}, [data.port, onlineServersCount, updateUserField]);

	const handleStart = async (server: Server) => {
		const serverId = createServerId(server.name, server.directory);

		if (isBusy) return;
		setIsBusy(true);
		setServerStatus(serverId, 'starting');
		updateServerStats(serverId, { players: 0, tps: 0, uptime: new Date() });
		try {
			await invoke('start_server', { directory: server.directory });
			setServerStatus(serverId, 'online');
		} catch (err) {
			setServerStatus(serverId, 'offline');
			const message = err instanceof Error ? err.message : 'Failed to start server.';
			window.alert(message);
		} finally {
			setIsBusy(false);
		}
	};

	return onlineServersCount > 0 ? (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='flex flex-col items-center text-center'>
			<CircleCheck className='size-20 text-green-500 mb-6' />
			<p className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>You&apos;re Ready</p>
			<p className='mb-10'>You and other players can now connect to your server!</p>
			<Button asChild>
				<Link to='/'>Back Home</Link>
			</Button>
		</m.div>
	) : (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='flex flex-col items-center text-center'>
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
		</m.div>
	);
}
