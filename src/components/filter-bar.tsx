import * as React from 'react';
import { ArrowUpDown, ChevronDown, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { cn } from '@/lib/utils';

export type FilterBarOption<T extends string = string> = {
	value: T;
	label: React.ReactNode;
	/** A lucide icon (or any component taking `className`) shown before the label. */
	icon?: React.ComponentType<{ className?: string }>;
	disabled?: boolean;
};

type FilterBarFilterBase = {
	/** Stable key for the chip (also used in test ids and aria labels). */
	id: string;
	/** Chip text, also the dropdown heading: `Provider`, `Loader`, `Version`. */
	label: string;
	icon?: React.ComponentType<{ className?: string }>;
	disabled?: boolean;
};

/** Any number of options can be on. The chip shows how many (`Provider · 2`). */
export type FilterBarMultiFilter<T extends string = string> = FilterBarFilterBase & {
	type: 'multi';
	options: readonly FilterBarOption<T>[];
	value: readonly T[];
	// Method syntax keeps this bivariant, so a `Provider[]` handler fits `FilterBarFilter`.
	onValueChange(value: T[]): void;
};

/**
 * One option at a time. `null` (or `defaultValue`) means "not filtering"; the
 * chip then shows only its label, otherwise the picked option (`Loader · Fabric`).
 */
export type FilterBarSingleFilter<T extends string = string> = FilterBarFilterBase & {
	type: 'single';
	options: readonly FilterBarOption<T>[];
	value: T | null;
	/** What the reset goes back to. Defaults to `null`. */
	defaultValue?: T | null;
	onValueChange(value: T | null): void;
};

export type FilterBarFilter = FilterBarMultiFilter | FilterBarSingleFilter;

export type FilterBarSearch = {
	value: string;
	onValueChange: (value: string) => void;
	placeholder?: string;
	'aria-label'?: string;
};

export type FilterBarSort<T extends string = string> = {
	options: readonly FilterBarOption<T>[];
	value: T;
	onValueChange(value: T): void;
	/** Heading inside the dropdown. Defaults to "Sort by". */
	label?: string;
	disabled?: boolean;
};

type FilterBarProps = {
	search?: FilterBarSearch;
	filters?: readonly FilterBarFilter[];
	sort?: FilterBarSort;
	/** Extra controls at the end of the row (a refresh button, a view toggle…). */
	children?: React.ReactNode;
	className?: string;
};

/** How many options of a filter are active (0 = not filtering). */
export const resolveFilterActiveCount = (filter: FilterBarFilter): number => {
	if (filter.type === 'multi') return filter.value.length;
	return filter.value !== null && filter.value !== (filter.defaultValue ?? null) ? 1 : 0;
};

const resetFilter = (filter: FilterBarFilter) => {
	if (filter.type === 'multi') filter.onValueChange([]);
	else filter.onValueChange(filter.defaultValue ?? null);
};

/** Plain text for an option, for aria labels (falls back to the value). */
const optionText = (option: FilterBarOption) =>
	typeof option.label === 'string' || typeof option.label === 'number' ? String(option.label) : option.value;

/** `Provider filter, 2 selected` / `Loader filter: Fabric` / `Loader filter`. */
const resolveChipAriaLabel = (filter: FilterBarFilter, activeCount: number) => {
	const base = `${filter.label} filter`;
	if (activeCount === 0) return base;
	if (filter.type === 'multi') return `${base}, ${activeCount} selected`;
	const picked = filter.options.find((option) => option.value === filter.value);
	return `${base}: ${picked ? optionText(picked) : filter.value}`;
};

const renderOptionContent = (option: FilterBarOption) => {
	const Icon = option.icon;
	return (
		<>
			{Icon && <Icon />}
			{option.label}
		</>
	);
};

/**
 * One row for search, filters and sort: the search input takes the free space,
 * each filter is a chip opening a dropdown, and the sort dropdown comes last.
 * Wraps on narrow widths instead of growing a side panel.
 */
function FilterBar({ search, filters = [], sort, children, className }: FilterBarProps) {
	return (
		<div data-slot='filter-bar' className={cn('flex w-full flex-wrap items-center gap-2', className)}>
			{search && <FilterBarSearchInput search={search} />}
			{filters.map((filter) => (
				<FilterBarChip key={filter.id} filter={filter} />
			))}
			{sort && <FilterBarSortMenu sort={sort} />}
			{children}
		</div>
	);
}

function FilterBarSearchInput({ search }: { search: FilterBarSearch }) {
	const inputRef = React.useRef<HTMLInputElement>(null);
	const placeholder = search.placeholder ?? 'Search';

	return (
		<InputGroup className='min-w-48 flex-1 basis-48'>
			<InputGroupInput
				ref={inputRef}
				type='search'
				placeholder={placeholder}
				aria-label={search['aria-label'] ?? placeholder}
				value={search.value}
				onChange={(event) => search.onValueChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Escape' && search.value) {
						event.preventDefault();
						search.onValueChange('');
					}
				}}
				// The native clear button would duplicate ours.
				className='[&::-webkit-search-cancel-button]:hidden'
			/>
			<InputGroupAddon>
				<Search />
			</InputGroupAddon>
			{search.value && (
				<InputGroupAddon align='inline-end'>
					<InputGroupButton
						size='icon-xs'
						aria-label='Clear search'
						onClick={() => {
							search.onValueChange('');
							inputRef.current?.focus();
						}}>
						<X />
					</InputGroupButton>
				</InputGroupAddon>
			)}
		</InputGroup>
	);
}

function FilterBarChip({ filter }: { filter: FilterBarFilter }) {
	const activeCount = resolveFilterActiveCount(filter);
	const isActive = activeCount > 0;
	const Icon = filter.icon;

	let summary: React.ReactNode = null;
	if (isActive) {
		if (filter.type === 'multi') summary = activeCount;
		else summary = filter.options.find((option) => option.value === filter.value)?.label ?? filter.value;
	}

	return (
		<div
			data-slot='filter-bar-chip'
			data-active={isActive}
			className={cn(
				'inline-flex h-9 items-center rounded-md bg-secondary text-secondary-foreground',
				isActive && 'bg-primary/15 text-foreground ring-1 ring-primary/40 ring-inset',
			)}>
			<DropdownMenu>
				<DropdownMenuTrigger asChild disabled={filter.disabled}>
					<Button
						variant='ghost'
						aria-label={resolveChipAriaLabel(filter, activeCount)}
						className={cn('h-9 hover:bg-transparent dark:hover:bg-transparent', isActive && 'pr-2')}>
						{Icon && <Icon />}
						<span>{filter.label}</span>
						{summary !== null && (
							<>
								<span aria-hidden className='text-muted-foreground'>
									·
								</span>
								<span className='max-w-32 truncate font-semibold'>{summary}</span>
							</>
						)}
						<ChevronDown className='opacity-60' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='start' className='min-w-48'>
					<DropdownMenuLabel className='text-muted-foreground text-xs'>{filter.label}</DropdownMenuLabel>
					{filter.type === 'multi' ? (
						filter.options.map((option) => (
							<DropdownMenuCheckboxItem
								key={option.value}
								disabled={option.disabled}
								checked={filter.value.includes(option.value)}
								// Keep the menu open so several options can be ticked in a row.
								onSelect={(event) => event.preventDefault()}
								onCheckedChange={(checked) => {
									const next = checked
										? [...filter.value, option.value]
										: filter.value.filter((value) => value !== option.value);
									// Keep the options' order so the result doesn't depend on click
									// order. Values without an option (stale saved state) are kept.
									const order = filter.options.map((candidate) => candidate.value);
									filter.onValueChange([
										...order.filter((value) => next.includes(value)),
										...next.filter((value) => !order.includes(value)),
									]);
								}}>
								{renderOptionContent(option)}
							</DropdownMenuCheckboxItem>
						))
					) : (
						<DropdownMenuRadioGroup
							value={filter.value ?? ''}
							onValueChange={(value) => filter.onValueChange(value)}>
							{filter.options.map((option) => (
								<DropdownMenuRadioItem key={option.value} value={option.value} disabled={option.disabled}>
									{renderOptionContent(option)}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					)}
					{isActive && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem inset onSelect={() => resetFilter(filter)}>
								Reset
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{isActive && (
				<Button
					variant='ghost'
					size='icon-sm'
					disabled={filter.disabled}
					aria-label={`Reset ${filter.label} filter`}
					className='mr-0.5 size-7 hover:bg-primary/20 dark:hover:bg-primary/20'
					onClick={() => resetFilter(filter)}>
					<X />
				</Button>
			)}
		</div>
	);
}

function FilterBarSortMenu({ sort }: { sort: FilterBarSort }) {
	const label = sort.label ?? 'Sort by';
	const current = sort.options.find((option) => option.value === sort.value);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild disabled={sort.disabled}>
				<Button variant='secondary' aria-label={`${label}: ${current ? optionText(current) : sort.value}`}>
					<ArrowUpDown />
					<span className='max-w-40 truncate'>{current?.label ?? sort.value}</span>
					<ChevronDown className='opacity-60' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='min-w-44'>
				<DropdownMenuLabel className='text-muted-foreground text-xs'>{label}</DropdownMenuLabel>
				<DropdownMenuRadioGroup value={sort.value} onValueChange={(value) => sort.onValueChange(value)}>
					{sort.options.map((option) => (
						<DropdownMenuRadioItem key={option.value} value={option.value} disabled={option.disabled}>
							{renderOptionContent(option)}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}


export { FilterBar };
