import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const TONE_CLASSES = {
	info: 'border-sky-500/40 bg-sky-500/10 [&_[data-callout-icon]]:text-sky-500',
	warning: 'border-amber-500/40 bg-amber-500/10 [&_[data-callout-icon]]:text-amber-500',
} as const;

/** A visible note inside a hosting setup slide (never hidden behind an accordion). */
export const SetupCallout: React.FC<{
	icon: LucideIcon;
	title: string;
	tone?: keyof typeof TONE_CLASSES;
	className?: string;
	children?: React.ReactNode;
}> = ({ icon: Icon, title, tone = 'info', className, children }) => (
	<div className={cn('flex w-full gap-3 rounded-xl border p-3 text-left text-sm', TONE_CLASSES[tone], className)}>
		<Icon data-callout-icon className='mt-0.5 size-4 shrink-0' />
		<div className='min-w-0 space-y-1'>
			<p className='font-semibold'>{title}</p>
			{children && <div className='space-y-1 text-muted-foreground'>{children}</div>}
		</div>
	</div>
);

/** A short bullet list for callouts and cards. */
export const SetupBullets: React.FC<{ items: React.ReactNode[]; className?: string }> = ({ items, className }) => (
	<ul className={cn('list-disc space-y-1 pl-4', className)}>
		{items.map((item, i) => (
			<li key={i}>{item}</li>
		))}
	</ul>
);
