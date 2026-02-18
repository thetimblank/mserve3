import { Button } from '@/components/ui/button';
import { useState } from 'react';
import Slide1 from './setup/Slide1';
import Slide0 from './setup/Slide0';
import { ArrowLeft } from 'lucide-react';
import Slide2 from './setup/Slide2';

const Setup: React.FC = () => {
	const [slide, setSlide] = useState(0);

	const nextSlide = () => setSlide((prev) => prev + 1);
	const prevSlide = () => setSlide((prev) => (prev > 0 ? prev - 1 : prev));

	const slides = [
		<Slide0 nextSlide={nextSlide} />,
		<Slide1 nextSlide={nextSlide} />,
		<Slide2 nextSlide={nextSlide} />,
	];

	return (
		<main className='pt-15 min-h-[calc(100vh-40px)] flex items-center justify-center p-12 w-full overflow-y-auto'>
			<Button variant='ghost' className='absolute left-[20%] top-0 m-20' onClick={prevSlide}>
				<ArrowLeft className='size-10' />
			</Button>
			{slides[slide]}
		</main>
	);
};

export default Setup;
