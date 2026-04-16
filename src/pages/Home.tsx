import CreateServer from '@/components/create-server';
import ImportServer from '@/components/import-server';
import Logo from '@/components/logo';
import ServerCard from '@/components/server-card';
import { useServers } from '@/data/servers';
import clsx from 'clsx';
import { m } from 'motion/react';
import { Skeleton } from '@/components/ui/skeleton';

const Home: React.FC = () => {
	const { servers, isReady } = useServers();

	return (
		<main
			className={clsx(
				'min-h-[calc(100vh-40px)] flex px-12 py-18 w-full overflow-y-auto',
				servers.length > 0 ? 'flex-col' : 'items-center justify-center',
			)}>
			{!isReady && (
				<div className='w-full min-h-[50vh] space-y-4'>
					<Skeleton className='h-10 w-64' />
					<Skeleton className='h-32 w-full' />
					<Skeleton className='h-32 w-full' />
					<Skeleton className='h-32 w-full' />
				</div>
			)}
			{isReady && servers.length === 0 && (
				<m.div
					initial={{ scale: 0.75, y: 10, opacity: 0 }}
					whileInView={{ scale: 1, y: 0, opacity: 1 }}
					transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
					className='flex flex-col items-center text-center'>
					<Logo size='lg' className='mb-6' />
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
					<div className='flex gap-4 items-center mb-4'>
						<Logo className='size-10' delay={0.2} />
						<h1 className='text-3xl font-bold flex gap-5 items-center w-fit'>Welcome back</h1>
					</div>
					<div className='flex flex-col gap-4'>
						{servers.map((server, i) => (
							<ServerCard delay={(i + 1) * 0.05} server={server} key={server.id} />
						))}
					</div>
					<div className='w-full flex flex-col items-center justify-center my-4'>
						<CreateServer />
						<ImportServer />
					</div>
				</m.div>
			)}
		</main>
	);
};

export default Home;
