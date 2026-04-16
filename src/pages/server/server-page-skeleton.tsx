import { Skeleton } from '@/components/ui/skeleton';

const ServerPageSkeleton: React.FC = () => {
	return (
		<main className='w-full min-h-[calc(100vh-40px)] relative overflow-y-auto'>
			<div className='min-h-full flex flex-col p-12 pt-20 w-full overflow-y-auto'>
				<div className='mb-8 space-y-3'>
					<Skeleton className='h-10 w-72' />
					<Skeleton className='h-4 w-96 max-w-full' />
				</div>

				<div className='mb-6 rounded-lg border border-border p-4'>
					<Skeleton className='h-28 w-full' />
				</div>

				<div className='mb-6 flex gap-3'>
					<Skeleton className='h-10 w-28' />
					<Skeleton className='h-10 w-28' />
					<Skeleton className='h-10 w-28' />
					<Skeleton className='h-10 w-36' />
				</div>

				<div className='mb-6 flex gap-3'>
					<Skeleton className='h-10 w-28' />
					<Skeleton className='h-10 w-28' />
					<Skeleton className='h-10 w-28' />
					<Skeleton className='h-10 w-28' />
					<Skeleton className='h-10 w-28' />
				</div>

				<div className='space-y-3'>
					<Skeleton className='h-20 w-full' />
					<Skeleton className='h-20 w-full' />
					<Skeleton className='h-20 w-full' />
				</div>
			</div>
		</main>
	);
};

export default ServerPageSkeleton;
