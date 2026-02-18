import CreateServer from '@/components/create-server';
import ImportServer from '@/components/import-server';
import ServerCard from '@/components/server-card';
import { createServerId, useServers } from '@/data/servers';
import { m } from 'motion/react';

const Home: React.FC = () => {
	const { servers, isReady } = useServers();

	return (
		<main className='pt-15 min-h-[calc(100vh-40px)] p-12 w-full overflow-y-auto'>
			{!isReady && <div className='w-full min-h-[50vh]'>Loading servers...</div>}
			{isReady && servers.length === 0 && (
				<m.div
					initial={{ scale: 0.75, y: 10, opacity: 0 }}
					whileInView={{ scale: 1, y: 0, opacity: 1 }}
					transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
					className='flex flex-col items-center text-center min-w-1/2 my-20'>
					<h1 className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>Welcome to MSERVE</h1>
					<p className='mb-10'>You have no servers yet!</p>
					<CreateServer />
					<ImportServer />
				</m.div>
			)}
			{isReady && servers.length > 0 && (
				<m.div
					initial={{ scale: 0.75, y: 10, opacity: 0 }}
					whileInView={{ scale: 1, y: 0, opacity: 1 }}
					transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
					className='flex flex-col min-w-1/2'>
					<h1 className='text-3xl font-bold flex gap-5 items-center mb-4 w-fit'>Welcome back</h1>
					{servers.map((server, i) => (
						<ServerCard
							delay={(i + 1) * 0.05}
							server={server}
							key={createServerId(server.name, server.directory)}
						/>
					))}
					<div className='w-full flex items-center justify-center my-4'>
						<CreateServer />
						<ImportServer />
					</div>
				</m.div>
			)}
		</main>
	);
};

export default Home;
