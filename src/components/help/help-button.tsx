/**
 * A small question-mark button that opens the quick-help slideshow for a
 * topic. Drop it next to any heading or field that tends to confuse people:
 *
 *   <HelpButton topic='backups' />
 */
import React from 'react';
import { CircleHelp } from 'lucide-react';
import clsx from 'clsx';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpSlideshow } from './help-slideshow';
import { HELP_TOPICS, type HelpTopicId } from './help-topics';

type HelpButtonProps = {
	topic: HelpTopicId;
	className?: string;
};

export const HelpButton: React.FC<HelpButtonProps> = ({ topic, className }) => {
	const [open, setOpen] = React.useState(false);

	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type='button'
						aria-label={`Learn about ${HELP_TOPICS[topic].title}`}
						onClick={() => setOpen(true)}
						className={clsx(
							'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground',
							className,
						)}>
						<CircleHelp className='size-4.5' />
					</button>
				</TooltipTrigger>
				<TooltipContent>
					<p className='font-bold'>Learn about {HELP_TOPICS[topic].title.toLowerCase()}</p>
				</TooltipContent>
			</Tooltip>
			<HelpSlideshow topic={topic} open={open} onOpenChange={setOpen} />
		</>
	);
};
