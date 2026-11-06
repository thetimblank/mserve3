import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UserProvider } from '@/data/user';
import SettingsServerPageSection from './settings-server-page-section';

const STORAGE_KEY = 'mserve.user.v1';

const renderSection = (stored: object) => {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
	return render(
		<UserProvider>
			<SettingsServerPageSection />
		</UserProvider>,
	);
};

const storedDisplay = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').server_page_display;

afterEach(() => {
	localStorage.clear();
});

describe('SettingsServerPageSection', () => {
	it('shows the beginner defaults as unchecked with no reset', async () => {
		renderSection({ experience_level: 'beginner' });
		const liveStats = screen.getByRole('checkbox', { name: 'Show live stats' });
		await waitFor(() => expect(liveStats).toHaveAttribute('data-state', 'unchecked'));

		expect(screen.getByRole('checkbox', { name: 'Show server details' })).toHaveAttribute(
			'data-state',
			'unchecked',
		);
		expect(screen.getAllByText(/Beginner default: hidden\./)).toHaveLength(2);
		expect(screen.queryByRole('button', { name: /Reset/ })).toBeNull();
	});

	it('stores an explicit choice and resets back to the level default', async () => {
		renderSection({ experience_level: 'beginner' });
		const liveStats = screen.getByRole('checkbox', { name: 'Show live stats' });
		await waitFor(() => expect(screen.getAllByText(/Beginner default/)).toHaveLength(2));

		fireEvent.click(liveStats);
		expect(liveStats).toHaveAttribute('data-state', 'checked');
		await waitFor(() => expect(storedDisplay()).toEqual({ show_live_stats: true, show_details: null }));

		fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
		expect(liveStats).toHaveAttribute('data-state', 'unchecked');
		await waitFor(() => expect(storedDisplay()).toEqual({ show_live_stats: null, show_details: null }));
		expect(screen.queryByRole('button', { name: /Reset/ })).toBeNull();
	});

	it('defaults to checked for standard', async () => {
		renderSection({ experience_level: 'standard' });
		await waitFor(() =>
			expect(screen.getByRole('checkbox', { name: 'Show live stats' })).toHaveAttribute('data-state', 'checked'),
		);
		expect(screen.getAllByText(/Standard default: shown\./)).toHaveLength(2);
	});
});
