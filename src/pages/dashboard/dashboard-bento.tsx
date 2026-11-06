/**
 * The dashboard bento: a fixed metrics/anchor row on top, then a rearrangeable,
 * hideable stack of clusters below (see `bento-shapes.ts`). No section headers:
 * each cluster opens with a title card, and the space between clusters does the
 * separating.
 *
 * - The root is the `@container` every bento grid sizes against.
 * - Cluster order + hidden set persist to user prefs (`dashboard_card_order` /
 *   `dashboard_hidden_cards`, ids from `DASHBOARD_CARD_IDS`); every change
 *   writes through immediately.
 * - Right-click any cluster → Hide (handled inside {@link BentoCluster}).
 * - The Edit Layout tile toggles edit mode: cards jiggle, clusters become
 *   @dnd-kit sortables, and a tray of hidden clusters appears for re-adding.
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
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
	SortableContext,
	arrayMove,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';

import type { Server } from '@/data/servers';
import type { ManagedNetwork } from '@/lib/network-schema';
import { DASHBOARD_CARD_IDS, type DashboardCardId, useUser } from '@/data/user';
import { Button } from '@/components/ui/button';

import DashboardMetrics from './dashboard-metrics';
import EditLayoutTile from './edit-layout-tile';
import BentoCluster from './bento-cluster';
import ServersCluster from './servers-cluster';
import StorageCluster from './storage-cluster';
import ActivityCluster from './activity-cluster';
import AttentionCluster from './attention-cluster';
import NetworksCluster from './networks-cluster';
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

	// The cards of each cluster (a fragment: the cluster owns the grid).
	const clusters: Record<DashboardCardId, React.ReactNode> = {
		servers: <ServersCluster servers={servers} />,
		storage: <StorageCluster servers={servers} storage={storage} />,
		activity: <ActivityCluster servers={servers} activity={activity} />,
		attention: <AttentionCluster servers={servers} networks={networks} storage={storage} />,
		networks: <NetworksCluster networks={networks} servers={servers} />,
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
		<div className='@container flex flex-col gap-10'>
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
					Drag a group of cards to move it. Right-click or tap <span className='font-medium'>−</span> to hide
					a group. Changes save automatically.
				</div>
			)}

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				modifiers={[restrictToVerticalAxis, restrictToParentElement]}
				onDragEnd={handleDragEnd}>
				<SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
					<div className='flex flex-col gap-10'>
						{visibleIds.map((id) => (
							<BentoCluster
								key={id}
								id={id}
								label={CARD_LABELS[id]}
								editMode={editMode}
								reducedMotion={reducedMotion}
								onHide={hide}>
								{clusters[id]}
							</BentoCluster>
						))}
					</div>
				</SortableContext>
			</DndContext>

			{editMode && hiddenIds.length > 0 && (
				<div className='rounded-xl border-2 border-dashed border-border/60 p-4'>
					<p className='mb-3 text-sm font-medium text-muted-foreground'>Hidden groups</p>
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
