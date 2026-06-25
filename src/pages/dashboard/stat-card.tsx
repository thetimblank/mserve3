/**
 * Compact headline metric tile for the dashboard's top bento row: an icon, a
 * label, a large value and an optional sub-line. Purely presentational.
 */
import React from 'react';
import { m } from 'motion/react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Props = {
	icon: React.ReactNode;
	label: string;
	value: React.ReactNode;
	hint?: React.ReactNode;
	color?: string;
	delay?: number;
	className?: string;
};

const StatCard: React.FC<Props> = ({ icon, label, value, hint, color, delay = 0, className }) => (
	<m.div
		initial={{ scale: 0.95, y: 8, opacity: 0 }}
		animate={{ scale: 1, y: 0, opacity: 1 }}
		transition={{ type: 'spring', duration: 0.4, bounce: 0, delay }}>
		<Card className={cn('relative gap-0 overflow-hidden p-5', className)}>
			<div className='flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase'>
				<span className='[&_svg]:size-4' style={color ? { color } : undefined}>
					{icon}
				</span>
				{label}
			</div>
			<div className='mt-2 text-3xl font-bold tabular-nums'>{value}</div>
			{hint != null && <div className='mt-1 text-xs text-muted-foreground'>{hint}</div>}
		</Card>
	</m.div>
);

export default StatCard;
