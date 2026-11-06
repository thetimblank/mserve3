import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { openMenu } from '@/test/radix-menu';
import { FilterBar, resolveFilterActiveCount, type FilterBarFilter } from './filter-bar';

type Provider = 'paper' | 'purpur' | 'vanilla';

const PROVIDER_OPTIONS = [
	{ value: 'paper', label: 'Paper' },
	{ value: 'purpur', label: 'Purpur' },
	{ value: 'vanilla', label: 'Vanilla' },
] as const;

const LOADER_OPTIONS = [
	{ value: 'any', label: 'Any loader' },
	{ value: 'fabric', label: 'Fabric' },
	{ value: 'quilt', label: 'Quilt' },
] as const;

const SORT_OPTIONS = [
	{ value: 'relevance', label: 'Relevance' },
	{ value: 'downloads', label: 'Downloads' },
] as const;

type HarnessProps = {
	initialProviders?: Provider[];
	initialLoader?: string;
	onProviders?: (value: Provider[]) => void;
	onSearch?: (value: string) => void;
	onSort?: (value: string) => void;
};

const Harness: React.FC<HarnessProps> = ({
	initialProviders = [],
	initialLoader = 'any',
	onProviders,
	onSearch,
	onSort,
}) => {
	const [search, setSearch] = React.useState('');
	const [providers, setProviders] = React.useState<Provider[]>(initialProviders);
	const [loader, setLoader] = React.useState<string | null>(initialLoader);
	const [sort, setSort] = React.useState('relevance');

	// A narrowed handler (`Provider[]`) must fit the filter type.
	const handleProviders = (value: Provider[]) => {
		setProviders(value);
		onProviders?.(value);
	};

	return (
		<FilterBar
			search={{
				value: search,
				onValueChange: (value) => {
					setSearch(value);
					onSearch?.(value);
				},
				placeholder: 'Search plugins',
			}}
			filters={[
				{
					id: 'provider',
					label: 'Provider',
					type: 'multi',
					options: PROVIDER_OPTIONS,
					value: providers,
					onValueChange: handleProviders,
				},
				{
					id: 'loader',
					label: 'Loader',
					type: 'single',
					options: LOADER_OPTIONS,
					value: loader,
					defaultValue: 'any',
					onValueChange: setLoader,
				},
			]}
			sort={{
				options: SORT_OPTIONS,
				value: sort,
				onValueChange: (value) => {
					setSort(value);
					onSort?.(value);
				},
			}}
		/>
	);
};

describe('FilterBar search', () => {
	it('types, clears with the button, and clears with Escape', () => {
		const onSearch = vi.fn();
		render(<Harness onSearch={onSearch} />);
		const input = screen.getByRole('searchbox', { name: 'Search plugins' });
		expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

		fireEvent.change(input, { target: { value: 'essentials' } });
		expect(onSearch).toHaveBeenLastCalledWith('essentials');
		fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
		expect(input).toHaveValue('');

		fireEvent.change(input, { target: { value: 'worldedit' } });
		fireEvent.keyDown(input, { key: 'Escape' });
		expect(input).toHaveValue('');
	});
});

describe('FilterBar multi filter', () => {
	it('shows the active count and a reset only while active', () => {
		const { unmount } = render(<Harness />);
		expect(screen.getByRole('button', { name: 'Provider filter' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Reset Provider filter' })).toBeNull();
		unmount();

		render(<Harness initialProviders={['paper', 'vanilla']} />);
		const trigger = screen.getByRole('button', { name: 'Provider filter, 2 selected' });
		expect(trigger).toHaveTextContent('Provider·2');
		expect(screen.getByRole('button', { name: 'Reset Provider filter' })).toBeInTheDocument();
	});

	it('toggles options in option order and keeps the menu open', () => {
		const onProviders = vi.fn();
		render(<Harness initialProviders={['vanilla']} onProviders={onProviders} />);
		const menu = openMenu(screen.getByRole('button', { name: 'Provider filter, 1 selected' }));

		fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Paper' }));
		expect(onProviders).toHaveBeenLastCalledWith(['paper', 'vanilla']);
		expect(screen.getByRole('menu')).toBeInTheDocument();

		fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Vanilla' }));
		expect(onProviders).toHaveBeenLastCalledWith(['paper']);
		expect(within(menu).getByRole('menuitemcheckbox', { name: 'Paper' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
	});

	it('keeps saved values that have no option', () => {
		const onProviders = vi.fn();
		render(<Harness initialProviders={['spigot' as Provider]} onProviders={onProviders} />);
		const menu = openMenu(screen.getByRole('button', { name: 'Provider filter, 1 selected' }));
		fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Paper' }));
		expect(onProviders).toHaveBeenLastCalledWith(['paper', 'spigot']);
	});

	it('resets from the chip button and from the menu', () => {
		const onProviders = vi.fn();
		const { unmount } = render(<Harness initialProviders={['paper', 'purpur']} onProviders={onProviders} />);
		fireEvent.click(screen.getByRole('button', { name: 'Reset Provider filter' }));
		expect(onProviders).toHaveBeenLastCalledWith([]);
		expect(screen.getByRole('button', { name: 'Provider filter' })).toBeInTheDocument();
		unmount();

		render(<Harness initialProviders={['paper']} onProviders={onProviders} />);
		const menu = openMenu(screen.getByRole('button', { name: 'Provider filter, 1 selected' }));
		fireEvent.click(within(menu).getByRole('menuitem', { name: 'Reset' }));
		expect(onProviders).toHaveBeenLastCalledWith([]);
	});
});

describe('FilterBar single filter', () => {
	it('shows the picked option and resets to the default', () => {
		render(<Harness />);
		expect(screen.getByRole('button', { name: 'Loader filter' })).not.toHaveTextContent('Any loader');

		const menu = openMenu(screen.getByRole('button', { name: 'Loader filter' }));
		fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Fabric' }));

		const trigger = screen.getByRole('button', { name: 'Loader filter: Fabric' });
		expect(trigger).toHaveTextContent('Loader·Fabric');
		fireEvent.click(screen.getByRole('button', { name: 'Reset Loader filter' }));
		expect(screen.getByRole('button', { name: 'Loader filter' })).toBeInTheDocument();
	});
});

describe('FilterBar sort', () => {
	it('shows the current sort and changes it', () => {
		const onSort = vi.fn();
		render(<Harness onSort={onSort} />);
		const trigger = screen.getByRole('button', { name: 'Sort by: Relevance' });
		const menu = openMenu(trigger);
		fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Downloads' }));
		expect(onSort).toHaveBeenCalledWith('downloads');
		expect(screen.getByRole('button', { name: 'Sort by: Downloads' })).toBeInTheDocument();
	});
});

describe('resolveFilterActiveCount', () => {
	it('counts multi values and non-default single values', () => {
		const base = { id: 'x', label: 'X', options: [] as { value: string; label: string }[] };
		const multi: FilterBarFilter = { ...base, type: 'multi', value: ['a', 'b'], onValueChange: vi.fn() };
		const single: FilterBarFilter = { ...base, type: 'single', value: 'a', onValueChange: vi.fn() };
		expect(resolveFilterActiveCount(multi)).toBe(2);
		expect(resolveFilterActiveCount(single)).toBe(1);
		expect(resolveFilterActiveCount({ ...single, value: null })).toBe(0);
		expect(resolveFilterActiveCount({ ...single, defaultValue: 'a' })).toBe(0);
	});
});
