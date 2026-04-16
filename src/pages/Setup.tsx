import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import SlideRepeatSetup from './setup/SlideRepeatSetup';
import SlideInitialSetup from './setup/SlideInitialSetup';
import Slide1 from './setup/Slide1';
import Slide2 from './setup/Slide2';
import Slide3 from './setup/Slide3';
import Slide4 from './setup/Slide4';
import { SetupProvider, useSetup } from './setup/SetupContext';
import { useUser } from '@/data/user';

const SetupContent: React.FC = () => {
	const { slide, prevSlide } = useSetup();
	const { user } = useUser();

	let slides = [<SlideInitialSetup />, <Slide1 />, <Slide2 />, <Slide3 />, <Slide4 />];

	if (user.initial_setup_hosting_tutorial_completed) {
		slides = [<SlideRepeatSetup />, <Slide1 />, <Slide2 />, <Slide3 />, <Slide4 />];
	}

	return (
		<main className='w-full h-full relative overflow-hidden'>
			{slide > 0 && (
				<Button variant='ghost' className='absolute mt-12 ml-2 size-12' onClick={prevSlide}>
					<ArrowLeft className='size-10' />
				</Button>
			)}
			<div className='pt-15 h-full min-h-0 flex items-center justify-center p-12 w-full overflow-y-auto app-scroll-area'>
				{slides[slide]}
			</div>
		</main>
	);
};

const Setup: React.FC = () => {
	return (
		<SetupProvider>
			<SetupContent />
		</SetupProvider>
	);
};

export default Setup;
