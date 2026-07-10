import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { UserProvider } from '@/data/user';
import { ServersProvider } from '@/data/servers';
import { JavaRuntimesProvider } from '@/data/java-runtimes';

import DashboardBento from './dashboard-bento';
import type { DashboardActivity } from './use-dashboard-activity';
import type { DashboardStorage } from './use-dashboard-storage';

const activity: DashboardActivity = {
	byServer: new Map(),
	ranked: [],
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
					<ServersProvider>
						<DashboardBento servers={[]} networks={[]} activity={activity} storage={storage} />
					</ServersProvider>
				</JavaRuntimesProvider>
			</UserProvider>
		</MemoryRouter>,
	);

describe('DashboardBento', () => {
	it('mounts the metrics row, the edit tile, and the bento cards', async () => {
		renderBento();
		// The Edit Layout tile (replaces the old gear button).
		expect(await screen.findByText('Edit layout')).toBeInTheDocument();
		// A couple of the draggable bento cards render their titles.
		expect(screen.getByText('Servers')).toBeInTheDocument();
		expect(screen.getByText('Storage breakdown')).toBeInTheDocument();
	});

	it('enters and exits edit mode from the block card', async () => {
		renderBento();
		fireEvent.click(await screen.findByText('Edit layout'));

		// The edit banner appears and the tile flips to "Done".
		expect(screen.getByText(/Drag cards to rearrange/)).toBeInTheDocument();
		expect(screen.getByText('Done')).toBeInTheDocument();

		fireEvent.click(screen.getByText('Done'));
		await waitFor(() => expect(screen.queryByText(/Drag cards to rearrange/)).not.toBeInTheDocument());
	});

	it('hides a card via the edit-mode badge and surfaces it in the hidden tray', async () => {
		renderBento();
		fireEvent.click(await screen.findByText('Edit layout'));

		const hideButtons = screen.getAllByLabelText('Hide card');
		expect(hideButtons.length).toBeGreaterThan(0);
		const before = hideButtons.length;

		fireEvent.click(hideButtons[0]);

		// The hidden-cards tray appears and one fewer card remains.
		expect(await screen.findByText('Hidden cards')).toBeInTheDocument();
		await waitFor(() => expect(screen.getAllByLabelText('Hide card').length).toBe(before - 1));
	});
});
