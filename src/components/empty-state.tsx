import * as React from 'react';
import { Inbox, SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type IconComponent = React.ComponentType<{ className?: string }>;

export type EmptyStateAction = {
	label: React.ReactNode;
	onClick: () => void;
	icon?: IconComponent;
	disabled?: boolean;
};

type EmptyStateProps = {
	/**
	 * `empty`: nothing exists yet. `no-results`: things exist, but the current
	 * search or filters hide all of them.
	 */
	variant?: 'empty' | 'no-results';
	/** An icon element (sized by the tile). Defaults to `Inbox` / `SearchX` by variant. */
	icon?: React.ReactNode;
	title: React.ReactNode;
	/** One short muted line under the title. */
	description?: React.ReactNode;
	action?: EmptyStateAction;
	secondaryAction?: EmptyStateAction;
	/** `no-results` only: adds a "Clear search" action that calls this. */
	onClearSearch?: () => void;
	clearSearchLabel?: string;
	className?: string;
};

const renderAction = (action: EmptyStateAction, variant: 'default' | 'secondary') => {
	const Icon = action.icon;
	return (
		<Button type='button' variant={variant} onClick={action.onClick} disabled={action.disabled}>
			{Icon && <Icon />}
			{action.label}
		</Button>
	);
};

const EmptyState: React.FC<EmptyStateProps> = ({
	variant = 'empty',
	icon,
	title,
	description,
	action,
	secondaryAction,
	onClearSearch,
	clearSearchLabel = 'Clear search',
	className,
}) => {
	const iconNode = icon ?? (variant === 'no-results' ? <SearchX /> : <Inbox />);
	const clearAction: EmptyStateAction | undefined =
		variant === 'no-results' && onClearSearch
			? { label: clearSearchLabel, onClick: onClearSearch }
			: undefined;
	const hasActions = Boolean(action || secondaryAction || clearAction);

	return (
		<div
			data-slot='empty-state'
			data-variant={variant}
			className={cn('my-10 flex flex-col items-center gap-3 px-4 text-center', className)}>
			<div className='mb-1 flex size-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground [&_svg]:size-7'>
				{iconNode}
			</div>
			<h3 className='text-xl font-bold text-foreground'>{title}</h3>
			{description && <p className='max-w-md text-sm text-muted-foreground'>{description}</p>}
			{hasActions && (
				<div className='mt-2 flex flex-wrap items-center justify-center gap-2'>
					{action && renderAction(action, 'default')}
					{secondaryAction && renderAction(secondaryAction, 'secondary')}
					{clearAction && renderAction(clearAction, 'secondary')}
				</div>
			)}
		</div>
	);
};

export default EmptyState;
