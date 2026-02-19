import { Button } from '@/components/ui/button';
import { m } from 'motion/react';
import { useSetup } from './SetupContext';
import { Network } from 'lucide-react';

export default function SlideInitialSetup() {
	const { nextSlide } = useSetup();

	return (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='flex flex-col items-center text-center'>
			<Network className='size-20 mb-6' />
			<h1 className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>Setup Hosting Servers</h1>
			<p className='mb-10'>This page will get you started on how to host your servers.</p>

			<Button onClick={nextSlide}>Continue</Button>
		</m.div>
	);
}
