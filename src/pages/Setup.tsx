import { Button } from '@/components/ui/button';
import Slide1 from './setup/Slide1';
import Slide0 from './setup/Slide0';
import { ArrowLeft } from 'lucide-react';
import Slide2 from './setup/Slide2';
import Slide3 from './setup/Slide3';
import { SetupProvider, useSetup } from './setup/SetupContext';
import Slide4 from './setup/Slide4';

const SetupContent: React.FC = () => {
	const { slide, prevSlide } = useSetup();

	const slides = [<Slide0 />, <Slide1 />, <Slide2 />, <Slide3 />, <Slide4 />];

	return (
		<main className='pt-15 min-h-[calc(100vh-40px)] flex items-center justify-center p-12 w-full overflow-y-auto'>
			<Button variant='ghost' className='absolute left-[20%] top-0 m-20' onClick={prevSlide}>
				<ArrowLeft className='size-10' />
			</Button>
			{slides[slide]}
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
