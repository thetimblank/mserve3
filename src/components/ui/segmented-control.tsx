import * as React from 'react';
import { m, useReducedMotion } from 'motion/react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useReducedMotionSetting } from '@/data/user';
import { cn } from '@/lib/utils';

export type SegmentedControlOption<T extends string> = {
	value: T;
	label: React.ReactNode;
	/** A lucide icon (or any component taking `className`) shown before the label. */
	icon?: React.ComponentType<{ className?: string }>;
	disabled?: boolean;
	/** Shown on hover/focus of the whole segment. */
	tooltip?: React.ReactNode;
	/** Needed when `label` is not plain text (or is visually hidden). */
	ariaLabel?: string;
};

const trackVariants = cva('inline-flex items-center gap-1 rounded-lg bg-secondary p-1', {
	variants: {
		fullWidth: {
			true: 'flex w-full',
			false: 'w-fit',
		},
	},
	defaultVariants: { fullWidth: false },
});

const itemVariants = cva(
	"relative isolate inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:cursor-default data-[state=on]:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			size: {
				sm: "h-7 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
				default: 'h-8 px-3 text-sm',
			},
			fullWidth: {
				true: 'flex-1',
				false: '',
			},
		},
		defaultVariants: { size: 'default', fullWidth: false },
	},
);

type SegmentedControlProps<T extends string> = {
	value: T;
	onValueChange: (value: T) => void;
	options: readonly SegmentedControlOption<T>[];
	disabled?: boolean;
	className?: string;
	itemClassName?: string;
	'aria-label'?: string;
	/**
	 * Forwarded to every segment. The MOTD editor uses it to keep the text
	 * selection alive while switching modes.
	 */
	onItemMouseDown?: React.MouseEventHandler<HTMLButtonElement>;
} & VariantProps<typeof itemVariants>;

/**
 * Single-choice control: one track with a pill that slides to the selected
 * option. Built on Radix `ToggleGroup` (roving focus, arrow keys, pressed state),
 * but never lets the selection go empty.
 */
function SegmentedControl<T extends string>({
	value,
	onValueChange,
	options,
	disabled,
	size,
	fullWidth,
	className,
	itemClassName,
	onItemMouseDown,
	'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
	const pillId = React.useId();
	const prefersReducedMotion = useReducedMotion();
	const reducedMotionSetting = useReducedMotionSetting();
	const animatePill = !prefersReducedMotion && !reducedMotionSetting;

	const handleValueChange = (next: string) => {
		// Radix reports '' when the active item is clicked again; a segmented
		// control always keeps one option selected.
		if (!next || next === value) return;
		onValueChange(next as T);
	};

	return (
		<ToggleGroupPrimitive.Root
			type='single'
			data-slot='segmented-control'
			value={value}
			onValueChange={handleValueChange}
			disabled={disabled}
			aria-label={ariaLabel}
			className={cn(trackVariants({ fullWidth }), className)}>
			{options.map((option) => {
				const isSelected = option.value === value;
				const Icon = option.icon;
				const descriptionId = option.tooltip ? `${pillId}-${option.value}-description` : undefined;
				const item = (
					<ToggleGroupPrimitive.Item
						key={option.value}
						value={option.value}
						disabled={option.disabled}
						aria-label={option.ariaLabel}
						aria-describedby={descriptionId}
						data-slot='segmented-control-item'
						onMouseDown={onItemMouseDown}
						className={cn(itemVariants({ size, fullWidth }), itemClassName)}>
						{isSelected &&
							(animatePill ? (
								<m.span
									layoutId={pillId}
									aria-hidden
									className='absolute inset-0 -z-10 rounded-md bg-primary shadow-xs'
									transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
								/>
							) : (
								<span
									aria-hidden
									className='absolute inset-0 -z-10 rounded-md bg-primary shadow-xs'
								/>
							))}
						{Icon && <Icon />}
						{option.label}
					</ToggleGroupPrimitive.Item>
				);

				if (!option.tooltip) return item;
				// The trigger is a wrapper, not the item itself: the tooltip's own
				// `data-state` would otherwise overwrite the item's `on`/`off`. The
				// hidden copy keeps the description reachable from the focused item.
				return (
					<Tooltip key={option.value}>
						<TooltipTrigger asChild>
							<span className={cn('inline-flex', fullWidth && 'flex-1 [&>button]:w-full')}>
								{item}
								<span id={descriptionId} className='sr-only'>
									{option.tooltip}
								</span>
							</span>
						</TooltipTrigger>
						<TooltipContent sideOffset={8}>{option.tooltip}</TooltipContent>
					</Tooltip>
				);
			})}
		</ToggleGroupPrimitive.Root>
	);
}

export { SegmentedControl };
