import React from 'react';
import { m } from 'motion/react';
import { Link } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';

import CreateServer from '@/components/create-server';
import ImportServer from '@/components/import-server';
import Logo from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useServers } from '@/data/servers';
import { useNetworks } from '@/data/networks';

import DashboardMetrics from './dashboard/dashboard-metrics';
import OnlineServers from './dashboard/online-servers';
import MostUsedServers from './dashboard/most-used-servers';
import DashboardNetworks from './dashboard/dashboard-networks';
import { useDashboardActivity } from './dashboard/use-dashboard-activity';

const greeting = () => {
	const hour = new Date().getHours();
	if (hour < 12) return 'Good morning';
	if (hour < 18) return 'Good afternoon';
	return 'Good evening';
};

const Home: React.FC = () => {
	const { servers, isReady } = useServers();
	const { networks } = useNetworks();
	const activity = useDashboardActivity(servers);

	return (
		<main className='h-full w-full overflow-y-auto app-scroll-area p-8 lg:p-12'>
			{!isReady && (
				<div className='space-y-6'>
					<Skeleton className='h-10 w-72' />
					<div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
						<Skeleton className='h-28' />
						<Skeleton className='h-28' />
						<Skeleton className='h-28' />
						<Skeleton className='h-28' />
					</div>
					<Skeleton className='h-64 w-full' />
				</div>
			)}

			{isReady && servers.length === 0 && (
				<div className='flex h-full items-center justify-center'>
					<m.div
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
						className='flex flex-col items-center text-center'>
						<Logo size='lg' className='mb-6' />
						<h1 className='mb-2 flex w-fit items-center gap-5 text-3xl font-bold'>Welcome to MSERVE</h1>
						<p className='mb-10'>Create or import your first server to get started.</p>
						<CreateServer />
						<ImportServer />
					</m.div>
				</div>
			)}

			{isReady && servers.length > 0 && (
				<div className='flex flex-col gap-8'>
					<m.header
						initial={{ y: 16, opacity: 0 }}
						animate={{ y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
						className='flex flex-wrap items-center justify-between gap-4'>
						<div className='flex items-center gap-4'>
							<Logo className='size-10' delay={0.2} />
							<div>
								<h1 className='text-3xl font-bold leading-tight'>{greeting()}</h1>
								<p className='text-sm text-muted-foreground'>
									Here's how your {servers.length} server{servers.length === 1 ? '' : 's'} are doing.
								</p>
							</div>
						</div>
						<Button asChild variant='outline'>
							<Link to='/servers'>
								<LayoutGrid /> All servers
							</Link>
						</Button>
					</m.header>

					<DashboardMetrics servers={servers} activity={activity} />

					<div className='grid gap-6 xl:grid-cols-5'>
						<div className='xl:col-span-3'>
							<OnlineServers servers={servers} />
						</div>
						<div className='xl:col-span-2'>
							<MostUsedServers servers={servers} activity={activity} />
						</div>
					</div>

					<DashboardNetworks networks={networks} servers={servers} />
				</div>
			)}
		</main>
	);
};

export default Home;
