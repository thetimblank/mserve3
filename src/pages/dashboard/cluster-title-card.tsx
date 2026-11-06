/**
 * The first card of every bento cluster: a big bold title and one number, with
 * an optional hint line and action. It replaces the old section headers, so the
 * title is the cluster's heading.
 */
import React from 'react';
import { Card } from '@/components/ui/card';

import BentoItem from './bento-item';

type Props = {
	title: string;
	value: React.ReactNode;
	hint?: React.ReactNode;
	action?: React.ReactNode;
};

const ClusterTitleCard: React.FC<Props> = ({ title, value, hint, action }) => (
	<BentoItem>
		{/* The card is a container so the number shrinks in narrow grid cells. */}
		<Card className='@container h-full justify-between gap-4 p-5'>
			<h2 className='text-xl font-bold leading-tight'>{title}</h2>
			<div className='space-y-3'>
				<div>
					<div className='text-4xl leading-none font-bold text-nowrap tabular-nums @[12rem]:text-5xl'>
						{value}
					</div>
					{hint != null && <div className='mt-2 text-sm text-muted-foreground'>{hint}</div>}
				</div>
				{action}
			</div>
		</Card>
	</BentoItem>
);

export default ClusterTitleCard;
