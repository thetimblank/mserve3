/**
 * A card with one on/off choice: title and a short description on the left,
 * the checkbox on the right. Clicking the title or description toggles it.
 * Content that only applies while it's on (a duration picker) goes in
 * `children` and shows under the description when checked.
 *
 *   <ToggleCard id='auto-restart' title='Restart after a crash'
 *     description='…' checked={on} onCheckedChange={setOn}
 *     titleAddon={<HelpButton topic='auto-restart' />} />
 */
import * as React from 'react';
import { AnimatePresence, m } from 'motion/react';

import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

type ToggleCardProps = {
	id: string;
	title: React.ReactNode;
	description?: React.ReactNode;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	/** Rendered next to the title, outside the clickable label (a HelpButton). */
	titleAddon?: React.ReactNode;
	disabled?: boolean;
	className?: string;
	/** Shown under the description while checked. */
	children?: React.ReactNode;
};

const reveal = {
	initial: { height: 0, opacity: 0 },
	animate: { height: 'auto', opacity: 1 },
	exit: { height: 0, opacity: 0 },
	transition: { type: 'spring', duration: 0.2, bounce: 0 },
} as const;

export const ToggleCard: React.FC<ToggleCardProps> = ({
	id,
	title,
	description,
	checked,
	onCheckedChange,
	titleAddon,
	disabled,
	className,
	children,
}) => (
	<div
		data-slot='toggle-card'
		data-state={checked ? 'checked' : 'unchecked'}
		className={cn(
			'rounded-2xl border-2 p-4 transition-colors dark:border-transparent dark:bg-secondary/50',
			checked && 'border-primary/40 dark:border-primary/40',
			className,
		)}>
		<div className='flex items-start gap-4'>
			<div className='min-w-0 flex-1'>
				<div className='flex items-center gap-1.5'>
					<label
						id={`${id}-title`}
						htmlFor={id}
						className={cn('font-semibold leading-snug', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
						{title}
					</label>
					{titleAddon}
				</div>
				{description && (
					<label
						id={`${id}-description`}
						htmlFor={id}
						className={cn(
							'mt-0.5 block text-sm text-muted-foreground',
							disabled ? 'cursor-not-allowed' : 'cursor-pointer',
						)}>
						{description}
					</label>
				)}
			</div>
			<Checkbox
				id={id}
				aria-labelledby={`${id}-title`}
				aria-describedby={description ? `${id}-description` : undefined}
				className='mt-1 size-5'
				checked={checked}
				disabled={disabled}
				onCheckedChange={(next) => onCheckedChange(next === true)}
			/>
		</div>
		{children && (
			<AnimatePresence initial={false}>
				{checked && (
					<m.div {...reveal} className='overflow-hidden'>
						<div className='pt-4'>{children}</div>
					</m.div>
				)}
			</AnimatePresence>
		)}
	</div>
);
