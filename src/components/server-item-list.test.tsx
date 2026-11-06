import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Plug } from 'lucide-react';
import { openMenu } from '@/test/radix-menu';
import type { ServerContentItem } from '@/data/servers';
import ServerItemList from './server-item-list';

vi.mock('@tauri-apps/api/webview', () => ({
	getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn(), revealItemInDir: vi.fn() }));

const plugins: ServerContentItem[] = [
	{ name: 'WorldEdit', file: 'worldedit.jar', activated: true, size: 2_000, source: 'modrinth', addedAt: 2 },
	{ name: 'Handmade', file: 'handmade.jar', activated: false, size: 9_000, addedAt: 1 },
];

const renderList = (props: Partial<React.ComponentProps<typeof ServerItemList>> = {}) =>
	render(
		<ServerItemList
			type='plugin'
			icon={<Plug />}
			serverDirectory='C:/servers/test'
			title='Plugins'
			searchPlaceholder='Search plugins'
			emptyLabel='No plugins yet'
			items={plugins}
			{...props}
		/>,
	);

const cardTitles = () =>
	screen.queryAllByText(/^(WorldEdit|Handmade)$/).map((element) => element.textContent);

const pickOption = (chipLabel: RegExp, option: string) => {
	const menu = openMenu(screen.getByRole('button', { name: chipLabel }));
	fireEvent.click(within(menu).getByRole('menuitemradio', { name: option }));
};

describe('ServerItemList', () => {
	it('puts a Find on Modrinth card next to the upload card', () => {
		const onFindOnModrinth = vi.fn();
		renderList({ onFindOnModrinth });

		fireEvent.click(screen.getByRole('button', { name: /Find on Modrinth/ }));
		expect(onFindOnModrinth).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: /Drop files/ })).toBeInTheDocument();
	});

	it('shows only the upload card and no Source filter for worlds', () => {
		renderList({
			type: 'world',
			title: 'Worlds',
			items: [{ name: 'world', file: 'world', activated: true, size: 10 }],
		});

		expect(screen.queryByRole('button', { name: /Find on Modrinth/ })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Status filter/ })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Source filter/ })).not.toBeInTheDocument();
	});

	it('filters by status and source, then clears the filters', () => {
		renderList({ onFindOnModrinth: vi.fn() });
		expect(cardTitles()).toEqual(['Handmade', 'WorldEdit']);

		pickOption(/Status filter/, 'Inactive');
		expect(cardTitles()).toEqual(['Handmade']);

		pickOption(/Source filter/, 'Modrinth');
		expect(cardTitles()).toEqual([]);
		expect(screen.getByText('No plugins match these filters.')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
		expect(cardTitles()).toEqual(['Handmade', 'WorldEdit']);
	});

	it('sorts by recently added', () => {
		renderList();
		pickOption(/Sort by/, 'Recently added');
		expect(cardTitles()).toEqual(['WorldEdit', 'Handmade']);
	});

	it('offers Modrinth from the empty state and hides the filter bar', () => {
		const onFindOnModrinth = vi.fn();
		renderList({ items: [], onFindOnModrinth });

		expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
		const empty = screen.getByText('No plugins yet').closest('[data-slot="empty-state"]') as HTMLElement;
		fireEvent.click(within(empty).getByRole('button', { name: 'Find on Modrinth' }));
		expect(onFindOnModrinth).toHaveBeenCalledTimes(1);
	});
});
