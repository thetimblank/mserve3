/**
 * The dashboard bento: a fixed metrics/anchor row on top, then a rearrangeable,
 * hideable grid of insight cards below.
 *
 * - Order + hidden set persist to user prefs (`dashboard_card_order` /
 *   `dashboard_hidden_cards`); every change writes through immediately.
 * - Right-click any card → Hide (handled inside {@link BentoCard}).
 * - The Edit Layout tile toggles edit mode: cards jiggle, become @dnd-kit
 *   sortables, and a tray of hidden cards appears for re-adding.
 */
import React from 'react';
import {
	DndContext,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';

import type { Server } from '@/data/servers';
import type { ManagedNetwork } from '@/lib/network-schema';
import { DASHBOARD_CARD_IDS, type DashboardCardId, useUser } from '@/data/user';
import { Button } from '@/components/ui/button';

import DashboardMetrics from './dashboard-metrics';
import EditLayoutTile from './edit-layout-tile';
import BentoCard from './bento-card';
import DashboardServers from './dashboard-servers';
import StorageInsights from './storage-insights';
import ActivityInsights from './activity-insights';
import NeedsAttention from './needs-attention';
import DashboardNetworks from './dashboard-networks';
import { BENTO_GRID_CLASSES, type BentoSize } from './bento-shapes';
import type { DashboardActivity } from './use-dashboard-activity';
import type { DashboardStorage } from './use-dashboard-storage';

type Props = {
	servers: Server[];
	networks: ManagedNetwork[];
	activity: DashboardActivity;
	storage: DashboardStorage;
};

const CARD_LABELS: Record<DashboardCardId, string> = {
	servers: 'Servers',
	storage: 'Storage',
	activity: 'Activity',
	attention: 'Could use a look',
	networks: 'Networks',
};

const DashboardBento: React.FC<Props> = ({ servers, networks, activity, storage }) => {
	const { user, updateUserField } = useUser();
	const [editMode, setEditMode] = React.useState(false);

	const reducedMotion = user.accessibility.reduced_motion;
	const order = user.dashboard_card_order as DashboardCardId[];
	const hidden = React.useMemo(
		() => new Set(user.dashboard_hidden_cards),
		[user.dashboard_hidden_cards],
	);

	const visibleIds = order.filter((id) => !hidden.has(id));
	const hiddenIds = order.filter((id) => hidden.has(id));

	// Content + shape for each card id. Insight surfaces are `h-full` so they fill
	// their bento cell.
	const cards: Record<DashboardCardId, { size: BentoSize; node: React.ReactNode }> = {
		servers: { size: 'full', node: <DashboardServers servers={servers} /> },
		storage: { size: 'lg', node: <StorageInsights servers={servers} storage={storage} /> },
		activity: { size: 'lg', node: <ActivityInsights servers={servers} activity={activity} /> },
		attention: { size: 'wide', node: <NeedsAttention servers={servers} storage={storage} /> },
		networks: { size: 'wide', node: <DashboardNetworks networks={networks} servers={servers} /> },
	};

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const oldIndex = order.indexOf(active.id as DashboardCardId);
		const newIndex = order.indexOf(over.id as DashboardCardId);
		if (oldIndex === -1 || newIndex === -1) return;
		updateUserField('dashboard_card_order', arrayMove(order, oldIndex, newIndex));
	};

	const hide = (id: string) => {
		updateUserField('dashboard_hidden_cards', (prev) => {
			const next = new Set(prev);
			next.add(id);
			return DASHBOARD_CARD_IDS.filter((cardId) => next.has(cardId));
		});
	};

	const unhide = (id: string) => {
		updateUserField('dashboard_hidden_cards', (prev) => prev.filter((cardId) => cardId !== id));
	};

	return (
		<div className='flex flex-col gap-6'>
			<DashboardMetrics
				servers={servers}
				activity={activity}
				storage={storage}
				trailing={
					<EditLayoutTile active={editMode} onToggle={() => setEditMode((prev) => !prev)} delay={0.22} />
				}
			/>

			{editMode && (
				<div className='rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-2 text-sm text-muted-foreground'>
					Drag cards to rearrange. Right-click or tap <span className='font-medium'>−</span> to hide.
					Changes save automatically.
				</div>
			)}

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				modifiers={[restrictToParentElement]}
				onDragEnd={handleDragEnd}>
				<SortableContext items={visibleIds} strategy={rectSortingStrategy}>
					<div className={BENTO_GRID_CLASSES}>
						{visibleIds.map((id, index) => (
							<BentoCard
								key={id}
								id={id}
								size={cards[id].size}
								editMode={editMode}
								reducedMotion={reducedMotion}
								jigglePhase={(index % 2) as 0 | 1}
								onHide={hide}>
								{cards[id].node}
							</BentoCard>
						))}
					</div>
				</SortableContext>
			</DndContext>

			{editMode && hiddenIds.length > 0 && (
				<div className='rounded-xl border-2 border-dashed border-border/60 p-4'>
					<p className='mb-3 text-sm font-medium text-muted-foreground'>Hidden cards</p>
					<div className='flex flex-wrap gap-2'>
						{hiddenIds.map((id) => (
							<Button key={id} size='sm' variant='secondary' onClick={() => unhide(id)}>
								<Plus />
								{CARD_LABELS[id]}
							</Button>
						))}
					</div>
				</div>
			)}
		</div>
	);
};

export default DashboardBento;
