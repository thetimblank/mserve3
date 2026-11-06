import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { UserProvider } from '@/data/user';
import { ServersProvider } from '@/data/servers';
import { JavaRuntimesProvider } from '@/data/java-runtimes';
import { JavaDownloadProvider } from '@/data/java-download';

import DashboardBento from './dashboard-bento';
import type { DashboardActivity } from './use-dashboard-activity';
import type { DashboardStorage } from './use-dashboard-storage';

const activity: DashboardActivity = {
	byServer: new Map(),
	totalInterruptions: 0,
	hourHistogram: new Array(24).fill(0),
	peakHour: null,
	isLoading: false,
};

const storage: DashboardStorage = {
	byDirectory: new Map(),
	totalBytes: 0,
	worldsBytes: 0,
	backupsBytes: 0,
	isLoading: false,
};

const renderBento = () =>
	render(
		<MemoryRouter>
			<UserProvider>
				<JavaRuntimesProvider>
					<JavaDownloadProvider>
						<ServersProvider>
							<DashboardBento servers={[]} networks={[]} activity={activity} storage={storage} />
						</ServersProvider>
					</JavaDownloadProvider>
				</JavaRuntimesProvider>
			</UserProvider>
		</MemoryRouter>,
	);

describe('DashboardBento', () => {
	it('mounts the metrics row, the edit tile, and one title card per cluster', async () => {
		renderBento();
		// The Edit Layout tile (replaces the old gear button).
		expect(await screen.findByText('Edit layout')).toBeInTheDocument();
		// Every cluster opens with a title card; there are no other section headers.
		const titles = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
		expect(titles).toEqual(['Servers', 'Storage', 'Activity', 'Could use a look', 'Networks']);
		// Each cluster is a labelled region.
		expect(screen.getByRole('region', { name: 'Storage' })).toBeInTheDocument();
	});

	it('shows the create-network card when there are no networks', async () => {
		renderBento();
		expect(await screen.findByText(/Create a network/)).toBeInTheDocument();
		expect(screen.getByText('Everything looks healthy')).toBeInTheDocument();
	});

	it('enters and exits edit mode from the block card', async () => {
		renderBento();
		fireEvent.click(await screen.findByText('Edit layout'));

		// The edit banner appears and the tile flips to "Done".
		expect(screen.getByText(/Drag a group of cards/)).toBeInTheDocument();
		expect(screen.getByText('Done')).toBeInTheDocument();

		fireEvent.click(screen.getByText('Done'));
		await waitFor(() => expect(screen.queryByText(/Drag a group of cards/)).not.toBeInTheDocument());
	});

	it('hides a cluster via the edit-mode badge and surfaces it in the hidden tray', async () => {
		renderBento();
		fireEvent.click(await screen.findByText('Edit layout'));

		const hideButtons = screen.getAllByRole('button', { name: /^Hide / });
		expect(hideButtons).toHaveLength(5);

		fireEvent.click(screen.getByRole('button', { name: 'Hide Servers' }));

		// The hidden tray appears with a re-add button, and one fewer cluster remains.
		expect(await screen.findByText('Hidden groups')).toBeInTheDocument();
		await waitFor(() => expect(screen.getAllByRole('button', { name: /^Hide / })).toHaveLength(4));
		// (In edit mode a cluster is a sortable, so its role is `button`: query the section by label.)
		expect(screen.queryByLabelText('Servers', { selector: 'section' })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Servers' }));
		await waitFor(() => expect(screen.getByLabelText('Servers', { selector: 'section' })).toBeInTheDocument());
	});
});
