import { SlideFrame, useSlideshow } from '@/components/slideshow';
import Logo from '@/components/logo';
import { Button } from '@/components/ui/button';

export default function Slide1() {
	const { nextSlide } = useSlideshow();

	return (
		<SlideFrame className='flex flex-col items-center text-center'>
			<Logo size='lg' className='mb-6' />
			<p className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>We got you.</p>
			<p>Mserve automatically manages Java versions.</p>
			<div className='mt-5 mb-10 text-left max-w-lg space-y-6'>
				<p>
					Mserve uses a smart detection system to find the correct java version, but dont worry, you can
					still override it by selecting your own version in the Java version dropdown.{' '}
				</p>
				<p>
					You can find the dropdown in your server's settings page under the java category or globally in
					your main settings.
				</p>
			</div>

			<Button className='ml-auto' onClick={nextSlide}>
				Continue
			</Button>
		</SlideFrame>
	);
}
