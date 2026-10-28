/**
 * Full-page slideshows (hosting setup, Java guide): a slide index shared
 * through context, the page shell with its back button, and the motion frame
 * every slide enters with. The create wizard (provider-dependent steps) and the
 * help dialog (a carousel in a modal) have their own navigation.
 */
import * as React from 'react';
import { m } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SlideshowContextValue = {
	slide: number;
	nextSlide: () => void;
	prevSlide: () => void;
};

const SlideshowContext = React.createContext<SlideshowContextValue | undefined>(undefined);

export const SlideshowProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [slide, setSlide] = React.useState(0);
	const value = React.useMemo<SlideshowContextValue>(
		() => ({
			slide,
			nextSlide: () => setSlide((prev) => prev + 1),
			prevSlide: () => setSlide((prev) => Math.max(0, prev - 1)),
		}),
		[slide],
	);
	return <SlideshowContext.Provider value={value}>{children}</SlideshowContext.Provider>;
};

export const useSlideshow = () => {
	const context = React.useContext(SlideshowContext);
	if (!context) {
		throw new Error('useSlideshow must be used within a SlideshowProvider');
	}
	return context;
};

/** The page around the current slide, with a back button after the first. */
export const SlideshowPage: React.FC<{ slides: React.ReactNode[] }> = ({ slides }) => {
	const { slide, prevSlide } = useSlideshow();

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

/** The entrance animation shared by every slide. */
export const SlideFrame: React.FC<{ className?: string; children: React.ReactNode }> = ({
	className,
	children,
}) => (
	<m.div
		initial={{ scale: 0.75, y: 10, opacity: 0 }}
		whileInView={{ scale: 1, y: 0, opacity: 1 }}
		transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
		className={cn(className)}>
		{children}
	</m.div>
);
