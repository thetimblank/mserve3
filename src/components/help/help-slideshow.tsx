/**
 * The universal quick-help slideshow: a compact, animated card deck (one idea
 * per slide) opened from question-mark buttons across the app. Content lives
 * in {@link file://./help-topics.tsx}; this component only renders and pages.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import clsx from 'clsx';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { HELP_TOPICS, type HelpTopicId } from './help-topics';

type HelpSlideshowProps = {
	topic: HelpTopicId;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

const slideVariants = {
	enter: (direction: 1 | -1) => ({ x: direction * 48, opacity: 0 }),
	center: { x: 0, opacity: 1 },
	exit: (direction: 1 | -1) => ({ x: direction * -48, opacity: 0 }),
};

export const HelpSlideshow: React.FC<HelpSlideshowProps> = ({ topic, open, onOpenChange }) => {
	const navigate = useNavigate();
	const definition = HELP_TOPICS[topic];
	const [[index, direction], setIndexState] = React.useState<[number, 1 | -1]>([0, 1]);

	// Restart from the first slide whenever the deck is (re)opened.
	React.useEffect(() => {
		if (open) setIndexState([0, 1]);
	}, [open, topic]);

	const slideCount = definition.slides.length;
	const isLast = index === slideCount - 1;

	const goTo = React.useCallback(
		(next: number, dir: 1 | -1) => {
			if (next < 0 || next >= slideCount) return;
			setIndexState([next, dir]);
		},
		[slideCount],
	);

	const handleNext = React.useCallback(() => {
		if (isLast) {
			onOpenChange(false);
			return;
		}
		goTo(index + 1, 1);
	}, [goTo, index, isLast, onOpenChange]);

	const handleBack = React.useCallback(() => goTo(index - 1, -1), [goTo, index]);

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === 'ArrowRight') handleNext();
		if (event.key === 'ArrowLeft') handleBack();
	};

	const slide = definition.slides[index];
	const Icon = slide.icon;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md overflow-hidden' onKeyDown={handleKeyDown}>
				<DialogTitle className='text-xs font-bold uppercase tracking-wider text-muted-foreground'>
					{definition.title}
				</DialogTitle>

				<div className='relative min-h-64'>
					<AnimatePresence mode='popLayout' custom={direction} initial={false}>
						<m.div
							key={index}
							custom={direction}
							variants={slideVariants}
							initial='enter'
							animate='center'
							exit='exit'
							transition={{ type: 'spring', duration: 0.35, bounce: 0 }}
							className='flex flex-col items-center px-2 pt-4 text-center'>
							<span className='mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary'>
								<Icon className='size-8' />
							</span>
							<h2 className='mb-3 text-xl font-bold'>{slide.title}</h2>
							<p className='text-sm leading-relaxed text-muted-foreground'>{slide.body}</p>
						</m.div>
					</AnimatePresence>
				</div>

				{definition.learnMore && isLast && (
					<Button
						variant='outline'
						className='mx-auto -mt-2'
						onClick={() => {
							onOpenChange(false);
							navigate(definition.learnMore!.to);
						}}>
						{definition.learnMore.label} <ArrowUpRight />
					</Button>
				)}

				<div className='flex items-center justify-between pt-1'>
					<Button variant='ghost' size='icon' onClick={handleBack} disabled={index === 0} aria-label='Previous'>
						<ArrowLeft />
					</Button>

					<div className='flex items-center gap-1.5' role='tablist' aria-label='Slides'>
						{definition.slides.map((_, dot) => (
							<button
								key={dot}
								type='button'
								role='tab'
								aria-selected={dot === index}
								aria-label={`Slide ${dot + 1}`}
								onClick={() => goTo(dot, dot > index ? 1 : -1)}
								className={clsx(
									'h-1.5 rounded-full transition-all duration-300',
									dot === index ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60',
								)}
							/>
						))}
					</div>

					<Button size='icon' onClick={handleNext} aria-label={isLast ? 'Done' : 'Next'}>
						{isLast ? <span className='px-1 text-xs font-bold'>OK</span> : <ArrowRight />}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
};
