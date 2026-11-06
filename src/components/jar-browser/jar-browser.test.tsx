import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { openMenu } from '@/test/radix-menu';
import { invokeMock, mockInvoke } from '@/test/tauri-mock';
import { getJarFiltersForTab } from '@/lib/jar-download-service';
import JarBrowser from './jar-browser';

const entry = (provider: string, version: string, stability = 'stable') => ({
	provider,
	tab: 'plugin',
	version,
	minecraftVersion: version,
	stability,
});

const waitForRows = () => waitFor(() => expect(screen.queryByText('Loading versions...')).toBeNull());

const [stable, unstable] = getJarFiltersForTab('plugin').stabilities;
const bothChannels = `${stable.label} and ${unstable.label}`;

/** Picks a Stability option, then closes the menu (an open menu hides the page from queries). */
const pickStability = (current: string, option: string) => {
	const menu = openMenu(screen.getByRole('button', { name: current }));
	fireEvent.click(within(menu).getByRole('menuitemradio', { name: option }));
	if (screen.queryByRole('menu')) fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
};

describe('JarBrowser', () => {
	it('keeps unstable builds selected after the reload the first pick triggers', async () => {
		mockInvoke('list_provider_versions', () => []);
		render(<JarBrowser selectedRowId={null} onSelectRow={vi.fn()} onLoadError={vi.fn()} />);
		expect(screen.getByLabelText('Proxies')).toBeInTheDocument();
		await waitForRows();
		expect(screen.getByLabelText('Proxies')).toBeInTheDocument();

		// Stable only is the default, so the chip doesn't count as an active filter.
		pickStability('Stability filter', bothChannels);

		await waitFor(() =>
			expect(invokeMock).toHaveBeenCalledWith('list_provider_versions', {
				payload: { tab: 'plugin', includeUnstable: true },
			}),
		);
		await waitForRows();
		expect(screen.getByRole('button', { name: `Stability filter: ${bothChannels}` })).toBeInTheDocument();
	});

	it('filters by provider and adds unstable builds next to stable ones', async () => {
		mockInvoke('list_provider_versions', (args) => {
			const { includeUnstable } = (args as { payload: { includeUnstable: boolean } }).payload;
			return [
				entry('paper', '1.21.11'),
				entry('folia', '1.21.8'),
				...(includeUnstable ? [entry('paper', '1.21.12-pre1', 'unstable')] : []),
			];
		});
		render(<JarBrowser selectedRowId={null} onSelectRow={vi.fn()} onLoadError={vi.fn()} />);
		await waitForRows();
		expect(screen.getByText('1.21.11')).toBeInTheDocument();
		expect(screen.getByText('1.21.8')).toBeInTheDocument();

		const menu = openMenu(screen.getByRole('button', { name: 'Provider filter' }));
		fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Folia' }));
		expect(screen.queryByText('1.21.11')).toBeNull();
		expect(screen.getByText('1.21.8')).toBeInTheDocument();
		fireEvent.keyDown(menu, { key: 'Escape' });
		fireEvent.click(screen.getByRole('button', { name: 'Reset Provider filter' }));
		expect(screen.getByText('1.21.11')).toBeInTheDocument();

		pickStability('Stability filter', bothChannels);
		await waitFor(() => expect(screen.getByText('1.21.12-pre1')).toBeInTheDocument());
		expect(screen.getByText('1.21.11')).toBeInTheDocument();

		// Reset goes back to stable only.
		fireEvent.click(screen.getByRole('button', { name: 'Reset Stability filter' }));
		expect(screen.queryByText('1.21.12-pre1')).toBeNull();
		expect(screen.getByText('1.21.11')).toBeInTheDocument();
	});

	it('shows only Java-compatible versions unless Any Java is picked', async () => {
		mockInvoke('list_provider_versions', () => [entry('paper', '1.21.11'), entry('paper', '1.16.5')]);
		render(
			<JarBrowser
				provider='paper'
				installedMajors={[8]}
				selectedRowId={null}
				onSelectRow={vi.fn()}
				onLoadError={vi.fn()}
			/>,
		);
		await waitForRows();
		expect(screen.queryByRole('button', { name: /Provider filter/ })).toBeNull();
		expect(screen.getByText('1.16.5')).toBeInTheDocument();
		expect(screen.queryByText('1.21.11')).toBeNull();

		const menu = openMenu(screen.getByRole('button', { name: 'Java filter' }));
		fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Any Java' }));
		expect(screen.getByText('1.21.11')).toBeInTheDocument();
		expect(screen.getByText('1.16.5')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Reset Java filter' }));
		expect(screen.queryByText('1.21.11')).toBeNull();
	});
});
