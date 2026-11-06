/**
 * Row primitives for settings pages. A page body is a `SettingsRows` stack
 * (rows separated by dividers); each `SettingsRow` puts its label and
 * description on the left and its control on the right. Wide controls (text
 * inputs, selectors, lists) go in `children`, under the label.
 *
 *   <SettingsRows>
 *     <SettingsRow title='Auto restart' description='…' htmlFor='auto-restart'
 *       control={<Checkbox id='auto-restart' … />} />
 *     <SettingsRow title='Server name' htmlFor='name'><Input id='name' … /></SettingsRow>
 *   </SettingsRows>
 */
import * as React from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export const SettingsRows: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
	<div
		data-slot='settings-rows'
		className={cn(
			'divide-y divide-border *:py-7 *:first:pt-0 *:last:pb-0',
			className,
		)}
		{...props}
	/>
);

type SettingsRowProps = {
	title: React.ReactNode;
	description?: React.ReactNode;
	/** Makes the title a label for this control id (clicking it focuses/toggles the control). */
	htmlFor?: string;
	/** Rendered next to the title (a HelpButton, a badge). */
	titleAddon?: React.ReactNode;
	/** Right-aligned control: a checkbox, a button, a small select. */
	control?: React.ReactNode;
	tone?: 'default' | 'destructive';
	className?: string;
	/** Full-width content under the label. */
	children?: React.ReactNode;
};

export const SettingsRow: React.FC<SettingsRowProps> = ({
	title,
	description,
	htmlFor,
	titleAddon,
	control,
	tone = 'default',
	className,
	children,
}) => {
	const titleClassName = cn('text-base leading-snug font-semibold', tone === 'destructive' && 'text-destructive');

	return (
		<div data-slot='settings-row' className={cn('space-y-4', className)}>
			<div className='flex items-start justify-between gap-6'>
				<div className='min-w-0 flex-1 space-y-1'>
					<div className='flex flex-wrap items-center gap-2'>
						{htmlFor ? (
							<Label htmlFor={htmlFor} className={titleClassName}>
								{title}
							</Label>
						) : (
							<div className={titleClassName}>{title}</div>
						)}
						{titleAddon}
					</div>
					{description && <div className='text-sm text-muted-foreground'>{description}</div>}
				</div>
				{control && <div className='flex shrink-0 items-center gap-2'>{control}</div>}
			</div>
			{children}
		</div>
	);
};
