import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { invokeMock, mockInvoke } from '@/test/tauri-mock';
import JarBrowser from './jar-browser';

const entry = (provider: string, version: string) => ({
	provider,
	tab: 'plugin',
	version,
	minecraftVersion: version,
	stability: 'stable',
});

describe('JarBrowser locked to a provider', () => {
	it('lists only that provider, without tabs, and tags the newest stable version', async () => {
		mockInvoke('list_provider_versions', () => [
			entry('paper', '1.21.11'),
			entry('paper', '1.21.10'),
			entry('folia', '1.21.8'),
		]);
		render(<JarBrowser provider='paper' selectedRowId={null} onSelectRow={vi.fn()} onLoadError={vi.fn()} />);
		await waitFor(() => expect(screen.queryByText('Loading versions...')).toBeNull());

		expect(invokeMock).toHaveBeenCalledWith('list_provider_versions', {
			payload: { tab: 'plugin', includeUnstable: false },
		});
		expect(screen.queryByLabelText('Proxies')).toBeNull();
		expect(screen.getByText('1.21.11')).toBeInTheDocument();
		expect(screen.getByText('1.21.10')).toBeInTheDocument();
		expect(screen.queryByText('1.21.8')).toBeNull();
		expect(screen.getAllByText('Latest')).toHaveLength(1);
		expect(screen.getByText('1.21.11').parentElement).toHaveTextContent('Latest');
	});
});
