/**
 * Titled container for a dashboard section, with an optional description and a
 * translucent card surface so the DarkVeil background reads through while
 * keeping the content legible. Used to wrap the insight blocks.
 */
import React from 'react';
import { m } from 'motion/react';
import { cn } from '@/lib/utils';

type Props = {
	title?: React.ReactNode;
	description?: React.ReactNode;
	action?: React.ReactNode;
	className?: string;
	children: React.ReactNode;
};

const DashboardSection: React.FC<Props> = ({ title, description, action, className, children }) => (
	<m.section
		initial={{ scale: 0.95, y: 8, opacity: 0 }}
		animate={{ scale: 1, y: 0, opacity: 1 }}
		transition={{ type: 'spring', duration: 0.4, bounce: 0 }}
		className={cn('bg-card text-card-foreground rounded-xl dark:bg-secondary/40 py-6 px-5', className)}>
		{(title || action) && (
			<div className='mb-4 flex items-start justify-between gap-3'>
				<div className='space-y-0.5'>
					{title && <h2 className='text-lg font-semibold leading-none'>{title}</h2>}
					{description && <p className='text-sm text-muted-foreground'>{description}</p>}
				</div>
				{action}
			</div>
		)}
		{children}
	</m.section>
);

export default DashboardSection;
