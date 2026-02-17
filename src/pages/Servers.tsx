import CreateServer from '@/components/create-server';
import { createServerId, useServers } from '@/data/servers';
import ServerCard from '@/components/server-card';

const Servers: React.FC = () => {
	const { servers, isReady } = useServers();

	return (
		<main className='pt-15 min-h-[calc(100vh-40px)] p-12 w-full overflow-y-auto'>
			<h1 className='text-3xl font-black mb-8'>All Servers</h1>
			{!isReady ? (
				<div className='text-muted-foreground'>Loading servers...</div>
			) : servers.length === 0 ? (
				<div className='text-muted-foreground'>No servers yet.</div>
			) : (
				servers.map((server) => (
					<ServerCard server={server} key={createServerId(server.name, server.directory)} />
				))
			)}

			<CreateServer />
		</main>
	);
};

export default Servers;
