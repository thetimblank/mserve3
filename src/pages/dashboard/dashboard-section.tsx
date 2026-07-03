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
		initial={{ y: 12, opacity: 0 }}
		animate={{ y: 0, opacity: 1 }}
		transition={{ type: 'spring', duration: 0.45, bounce: 0 }}
		className={cn(
			'rounded-xl border border-border/60 bg-card/80 p-5 backdrop-blur-sm',
			className,
		)}>
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
