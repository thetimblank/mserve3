import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { SlideProvider, useSlide } from './java-guide/SlideContext';
import Slide0 from './java-guide/Slide0';
import Slide1 from './java-guide/Slide1';
import Slide2 from './java-guide/Slide2';
import Slide3 from './java-guide/Slide3';

const JavaGuideContent: React.FC = () => {
	const { slide, prevSlide } = useSlide();

	let slides = [<Slide0 />, <Slide1 />, <Slide2 />, <Slide3 />];

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

const JavaGuide: React.FC = () => {
	return (
		<SlideProvider>
			<JavaGuideContent />
		</SlideProvider>
	);
};

export default JavaGuide;
