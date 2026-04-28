import { Button } from '@/components/ui/button';
import { m } from 'motion/react';
import { useSlide } from './SlideContext';
import { Coffee } from 'lucide-react';

export default function Slide0() {
	const { nextSlide } = useSlide();

	return (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='flex flex-col items-center text-center'>
			<Coffee className='size-20 mb-6' />
			<h1 className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>Java Version Guide</h1>
			<p className='mb-10'>
				This page detects your installed Java versions and tells you how to install a JDK.
			</p>

			<Button onClick={nextSlide}>Continue</Button>
		</m.div>
	);
}
