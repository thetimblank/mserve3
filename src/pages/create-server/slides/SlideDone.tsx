import { CircleCheck } from 'lucide-react';
import { m } from 'motion/react';
import { Button } from '@/components/ui/button';
import { useCreateServer } from '../CreateServerContext';

const SlideDone: React.FC = () => {
	const { createdServerId, goToCreatedServer } = useCreateServer();
	const showGoNow = Boolean(createdServerId);

	return (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='flex flex-col items-center text-center'>
			<CircleCheck className='size-20 text-green-500 mb-6' />
			<p className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>Server created</p>
			<p className='mb-10'>Setup is complete. Redirecting to your server.</p>
			{showGoNow && (
				<Button type='button' onClick={goToCreatedServer}>
					Go now
				</Button>
			)}
		</m.div>
	);
};

export default SlideDone;
