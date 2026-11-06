import { SlideFrame, useSlideshow } from '@/components/slideshow';
import { Button } from '@/components/ui/button';
import { Wifi } from 'lucide-react';
import { useUser } from '@/data/user';

export default function SlideRepeatSetup() {
	const { nextSlide } = useSlideshow();
	const { user } = useUser();
	const ports = user.completed_setup_hosting_ports;

	return (
		<SlideFrame className='flex flex-col items-center text-center'>
			<Wifi className='size-20 mb-6' />
			<h1 className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>Host another server</h1>
			<p className='mb-4'>
				Set up another server, or try the other way to let friends join. <br />
				A forwarded port works for every server that uses it, so you may not need to repeat this.
			</p>
			{ports.length > 0 && (
				<p className='mb-10 font-bold'>
					Ports you set up in this guide before: {ports.join(', ')}
				</p>
			)}

			<Button className={ports.length > 0 ? undefined : 'mt-6'} onClick={nextSlide}>
				Continue
			</Button>
		</SlideFrame>
	);
}
