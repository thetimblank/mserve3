import CreateServer from '@/components/create-server';
import ServerCard from '@/components/server-card';
import { createServerId, useServers } from '@/data/servers';
import { m } from 'motion/react';

const Home: React.FC = () => {
	const { servers } = useServers();

	return (
		<main className='pt-15 min-h-[calc(100vh-40px)] p-12 w-full overflow-y-auto'>
			<div className='flex flex-col min-w-1/2'>
				<m.h1
					initial={{ y: 50, opacity: 0 }}
					whileInView={{ y: 0, opacity: 1 }}
					transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
					className='text-3xl font-bold flex gap-5 items-center mb-4 w-fit'>
					Welcome back
				</m.h1>
				{servers.map((server, i) => (
					<ServerCard
						delay={(i + 1) * 0.05}
						server={server}
						key={createServerId(server.name, server.directory)}
					/>
				))}
			</div>
			<div className='w-full flex items-center justify-center my-4'>
				<CreateServer />
			</div>
		</main>
	);
};

export default Home;
