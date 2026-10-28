import { SlideFrame, useSlideshow } from '@/components/slideshow';
import { Button } from '@/components/ui/button';
import { Wifi } from 'lucide-react';

export default function SlideInitialSetup() {
	const { nextSlide } = useSlideshow();

	return (
		<SlideFrame className='flex flex-col items-center text-center'>
			<Wifi className='size-20 mb-6' />
			<h1 className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>Setup Hosting Servers</h1>
			<p className='mb-10'>
				This page will get you started on how to let others connect to your server. <br /> This is a one
				time thing. (For each port)
			</p>

			<Button onClick={nextSlide}>Continue</Button>
		</SlideFrame>
	);
}
