/**
 * Wrapper for one bento cluster (a title card plus its item cards). Owns the
 * cluster's grid and three concerns, nothing else (each card renders its own
 * surface; the cluster has none):
 *   1. Lays the cards out on {@link BENTO_CLUSTER_GRID_CLASSES}.
 *   2. Right-click → "Hide" (Radix ContextMenu, so the global
 *      native-context-menu handler, which bails on defaultPrevented, lets it
 *      through). Works in and out of edit mode.
 *   3. In edit mode: makes the whole cluster a @dnd-kit sortable, jiggles each
 *      card springboard-style (CSS keyframes on the cards, so they don't fight
 *      dnd-kit's transform on this node), and shows a "−" hide badge. The cards
 *      are `inert` (no pointer, focus or keyboard) so dragging never triggers
 *      their controls.
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

import { BENTO_CLUSTER_GRID_CLASSES } from './bento-shapes';

type Props = {
	id: string;
	/** Human name, used for the section label and the hide controls. */
	label: string;
	editMode: boolean;
	reducedMotion: boolean;
	onHide: (id: string) => void;
	children: React.ReactNode;
};

const BentoCluster: React.FC<Props> = ({ id, label, editMode, reducedMotion, onHide, children }) => {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id,
		disabled: !editMode,
	});

	// `inert` isn't in React 18's DOM types, so set it on the node directly.
	const gridRef = React.useRef<HTMLDivElement>(null);
	React.useEffect(() => {
		gridRef.current?.toggleAttribute('inert', editMode);
	}, [editMode]);

	const style: React.CSSProperties = {
		transform: CSS.Translate.toString(transform),
		transition,
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<section
					ref={setNodeRef}
					style={style}
					aria-label={label}
					className={cn('relative', isDragging && 'z-50 opacity-80')}
					{...(editMode ? attributes : {})}
					{...(editMode ? listeners : {})}>
					<div
						className={cn(
							'relative',
							editMode &&
								'cursor-grab rounded-2xl ring-2 ring-primary/40 ring-offset-4 ring-offset-background select-none active:cursor-grabbing',
						)}>
						<div
							ref={gridRef}
							className={cn(
								BENTO_CLUSTER_GRID_CLASSES,
								editMode && 'pointer-events-none',
								editMode && !isDragging && !reducedMotion && 'bento-jiggle-cards',
							)}>
							{children}
						</div>

						{editMode && (
							<button
								type='button'
								aria-label={`Hide ${label}`}
								// Keep the cluster's drag sensors (pointer and Enter/Space) off the badge.
								onPointerDown={(event) => event.stopPropagation()}
								onKeyDown={(event) => event.stopPropagation()}
								onClick={(event) => {
									event.stopPropagation();
									onHide(id);
								}}
								className='absolute -top-3 -left-3 z-10 flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md transition-transform hover:scale-110'>
								<Minus className='size-4' />
							</button>
						)}
					</div>
				</section>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem variant='destructive' onSelect={() => onHide(id)}>
					<Minus />
					Hide group
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
};

export default BentoCluster;
