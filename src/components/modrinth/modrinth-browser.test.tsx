import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { openMenu } from '@/test/radix-menu';
import { invokeMock, mockInvoke } from '@/test/tauri-mock';
import ModrinthBrowser from './modrinth-browser';

type SearchPayload = { loaders: string[]; gameVersions: string[]; categories: string[]; index: string };

const lastSearch = (): SearchPayload => {
	const calls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'search_modrinth_projects');
	return (calls[calls.length - 1]?.[1] as { payload: SearchPayload }).payload;
};

const setup = () => {
	mockInvoke('get_modrinth_tags', () => ({
		categories: [
			{ name: 'economy', projectType: 'plugin', header: 'categories' },
			{ name: 'world-generation', projectType: 'plugin', header: 'categories' },
		],
		gameVersions: [
			{ version: '1.21.4', versionType: 'release', major: false },
			{ version: '25w01a', versionType: 'snapshot', major: false },
			{ version: '1.20.1', versionType: 'release', major: false },
		],
	}));
	mockInvoke('search_modrinth_projects', () => ({ hits: [], offset: 0, limit: 20, totalHits: 0 }));
	render(
		<ModrinthBrowser
			projectType='plugin'
			pinnedLoaders={['paper', 'spigot']}
			pinnedGameVersion='1.21.4'
			onInstallVersion={vi.fn()}
		/>,
	);
};

describe('ModrinthBrowser filters', () => {
	it('starts pinned to the server and resets back to the pins', async () => {
		setup();
		await waitFor(() =>
			expect(lastSearch()).toMatchObject({ loaders: ['paper', 'spigot'], gameVersions: ['1.21.4'] }),
		);
		// The version pin covers the game version, so its chip only shows once the pin is off.
		expect(screen.queryByRole('button', { name: /Game version filter/ })).toBeNull();

		const menu = openMenu(screen.getByRole('button', { name: 'Compatibility filter' }));
		fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Show everything' }));
		await waitFor(() => expect(lastSearch()).toMatchObject({ loaders: [], gameVersions: [] }));

		fireEvent.click(screen.getByRole('button', { name: 'Reset Compatibility filter' }));
		await waitFor(() =>
			expect(lastSearch()).toMatchObject({ loaders: ['paper', 'spigot'], gameVersions: ['1.21.4'] }),
		);
	});

	it('keeps the loader pin alone and lets a release version replace the version pin', async () => {
		setup();
		const pins = openMenu(screen.getByRole('button', { name: 'Compatibility filter' }));
		fireEvent.click(within(pins).getByRole('menuitemradio', { name: 'Paper, any version' }));
		await waitFor(() => expect(lastSearch()).toMatchObject({ loaders: ['paper', 'spigot'], gameVersions: [] }));

		const versions = openMenu(await screen.findByRole('button', { name: 'Game version filter' }));
		expect(within(versions).queryByRole('menuitemradio', { name: '25w01a' })).toBeNull();
		fireEvent.click(within(versions).getByRole('menuitemradio', { name: '1.20.1' }));
		await waitFor(() => expect(lastSearch()).toMatchObject({ gameVersions: ['1.20.1'] }));
	});

	it('sends picked categories and the sort order', async () => {
		setup();
		const categories = openMenu(await screen.findByRole('button', { name: 'Categories filter' }));
		fireEvent.click(within(categories).getByRole('menuitemcheckbox', { name: 'World Generation' }));
		await waitFor(() => expect(lastSearch()).toMatchObject({ categories: ['world-generation'] }));
		fireEvent.keyDown(categories, { key: 'Escape' });

		const sort = openMenu(screen.getByRole('button', { name: 'Sort by: Relevance' }));
		fireEvent.click(within(sort).getByRole('menuitemradio', { name: 'Downloads' }));
		await waitFor(() => expect(lastSearch()).toMatchObject({ index: 'downloads', categories: ['world-generation'] }));
	});
});
