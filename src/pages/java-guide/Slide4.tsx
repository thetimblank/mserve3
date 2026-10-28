import { SlideFrame } from '@/components/slideshow';
import { Button } from '@/components/ui/button';
import { CircleCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Slide4() {
	return (
		<SlideFrame className='flex flex-col items-center text-center'>
			<CircleCheck className='size-20 text-green-500 mb-6' />
			<p className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>That&apos;s it!</p>
			<p className='mb-10'>Thats all you need to know about Java JDKs.</p>
			<Button asChild>
				<Link to='/'>Back Home</Link>
			</Button>
		</SlideFrame>
	);
}
