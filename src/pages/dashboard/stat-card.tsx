/**
 * Compact metric tile: an icon, a label, a large value and an optional sub-line.
 * Used in the dashboard's top row and as the stacked stats inside clusters
 * (`compact`). Fills its grid cell. Purely presentational.
 */
import React from 'react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import BentoItem from './bento-item';

type Props = {
	icon: React.ReactNode;
	label: string;
	value: React.ReactNode;
	hint?: React.ReactNode;
	color?: string;
	delay?: number;
	/** Tighter padding and a smaller value, for two cards stacked in one cell. */
	compact?: boolean;
	className?: string;
};

const StatCard: React.FC<Props> = ({ icon, label, value, hint, color, delay = 0, compact, className }) => (
	<BentoItem delay={delay}>
		<Card className={cn('relative h-full justify-center gap-0 overflow-hidden', compact ? 'p-4' : 'p-5', className)}>
			<div className='flex items-center gap-2 text-nowrap text-xs font-medium tracking-wide text-muted-foreground uppercase'>
				<span className='[&_svg]:size-4' style={color ? { color } : undefined}>
					{icon}
				</span>
				{label}
			</div>
			<div className={cn('font-bold tabular-nums text-nowrap', compact ? 'mt-1 text-2xl' : 'mt-2 text-3xl')}>
				{value}
			</div>
			{hint != null && <div className='mt-1 truncate text-xs text-muted-foreground'>{hint}</div>}
		</Card>
	</BentoItem>
);

export default StatCard;
