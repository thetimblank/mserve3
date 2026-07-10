/**
 * Grid-item wrapper for a single bento card. Owns three concerns and nothing
 * else (the card's own content renders its own surface):
 *   1. Places the card on the bento grid via its {@link BentoSize} span classes.
 *   2. Right-click → "Hide card" (Radix ContextMenu, so the global
 *      native-context-menu handler — which bails on defaultPrevented — lets it
 *      through). Works in and out of edit mode.
 *   3. In edit mode: makes the card a @dnd-kit sortable, applies the springboard
 *      jiggle (CSS keyframes on an inner node so it doesn't fight dnd-kit's
 *      transform), and shows a "−" hide badge. Child pointer events are disabled
 *      so dragging the card never triggers the content beneath.
 */
import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Minus } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from '@/components/ui/context-menu';

import { bentoSizeClasses, type BentoSize } from './bento-shapes';

type Props = {
	id: string;
	size: BentoSize;
	editMode: boolean;
	reducedMotion: boolean;
	/** Alternating jiggle phase so neighbouring cards don't move in lockstep. */
	jigglePhase: 0 | 1;
	onHide: (id: string) => void;
	children: React.ReactNode;
};

const BentoCard: React.FC<Props> = ({ id, size, editMode, reducedMotion, jigglePhase, onHide, children }) => {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id,
		disabled: !editMode,
	});

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	const jiggleClass = reducedMotion ? '' : jigglePhase === 0 ? 'bento-jiggle' : 'bento-jiggle-alt';

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					ref={setNodeRef}
					style={style}
					className={cn(
						bentoSizeClasses(size),
						'relative',
						isDragging && 'z-50 opacity-80',
					)}
					{...(editMode ? attributes : {})}
					{...(editMode ? listeners : {})}>
					<div
						className={cn(
							'relative h-full',
							editMode && 'cursor-grab active:cursor-grabbing select-none',
							editMode && !isDragging && jiggleClass,
							editMode &&
								'rounded-xl ring-2 ring-primary/40 ring-offset-2 ring-offset-background transition-shadow',
						)}>
						{/* Block interaction with the card's own controls while editing. */}
						<div className={cn('h-full', editMode && 'pointer-events-none')}>{children}</div>

						{editMode && (
							<button
								type='button'
								aria-label='Hide card'
								onPointerDown={(event) => event.stopPropagation()}
								onClick={(event) => {
									event.stopPropagation();
									onHide(id);
								}}
								className='absolute -left-2 -top-2 z-10 flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md transition-transform hover:scale-110'>
								<Minus className='size-4' />
							</button>
						)}
					</div>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem variant='destructive' onSelect={() => onHide(id)}>
					<Minus />
					Hide card
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
};

export default BentoCard;
