import { SlideFrame, useSlideshow } from '@/components/slideshow';
import { Button } from '@/components/ui/button';
import { Wifi } from 'lucide-react';

export default function SlideInitialSetup() {
	const { nextSlide } = useSlideshow();

	return (
		<SlideFrame className='flex flex-col items-center text-center'>
			<Wifi className='size-20 mb-6' />
			<h1 className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>Let friends join your server</h1>
			<p className='mb-10'>
				This guide makes your server reachable from outside your home network. <br /> You only do this
				once (once per port if you forward ports).
			</p>

			<Button onClick={nextSlide}>Continue</Button>
		</SlideFrame>
	);
}
