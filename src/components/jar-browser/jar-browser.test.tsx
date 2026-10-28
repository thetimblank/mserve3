import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { invokeMock, mockInvoke } from '@/test/tauri-mock';
import { getJarFiltersForTab } from '@/lib/jar-download-service';
import JarBrowser from './jar-browser';

describe('JarBrowser', () => {
	it('keeps unstable builds selected after the reload the first click triggers', async () => {
		mockInvoke('list_provider_versions', () => []);
		render(<JarBrowser selectedRowId={null} onSelectRow={vi.fn()} onLoadError={vi.fn()} />);
		await waitFor(() => expect(screen.queryByText('Loading versions...')).toBeNull());

		const unstableLabel = getJarFiltersForTab('plugin').stabilities[1].label;
		const toggle = () => within(screen.getByText(unstableLabel).closest('label')!).getByRole('checkbox');
		fireEvent.click(toggle());

		await waitFor(() =>
			expect(invokeMock).toHaveBeenCalledWith('list_provider_versions', {
				payload: { tab: 'plugin', includeUnstable: true },
			}),
		);
		await waitFor(() => expect(screen.queryByText('Loading versions...')).toBeNull());
		expect(toggle()).toHaveAttribute('data-state', 'checked');
	});
});
