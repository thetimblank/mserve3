import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { mockInvoke } from '@/test/tauri-mock';
import Setup from './Setup';

vi.mock('@/data/user', () => ({
	useUser: () => ({
		user: { initial_setup_hosting_tutorial_completed: false, completed_setup_hosting_ports: [] },
		updateUserField: vi.fn(),
	}),
}));

beforeAll(() => {
	// SlideFrame animates with `whileInView`, which jsdom has no observer for.
	globalThis.IntersectionObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	} as unknown as typeof IntersectionObserver;
});

const renderSetup = () =>
	render(
		<MemoryRouter>
			<Setup />
		</MemoryRouter>,
	);

describe('Setup hosting guide', () => {
	it('offers both paths with pros and cons after the intro', () => {
		mockInvoke('get_local_ip', () => '192.168.1.20');
		renderSetup();

		fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

		expect(screen.getByRole('heading', { name: 'How will friends join?' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Use a tunnel' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Port forward' })).toBeInTheDocument();
		expect(screen.getAllByText('Pros')).toHaveLength(2);
		expect(screen.getByText('Impossible behind CGNAT')).toBeInTheDocument();
	});

	it('switches from port forwarding to the tunnel branch', async () => {
		mockInvoke('get_playit_status', () => ({ claimed: false }));
		renderSetup();

		fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		fireEvent.click(screen.getByRole('button', { name: 'Port forward' }));
		expect(screen.getByRole('heading', { name: 'Before you start' })).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Use a tunnel instead' }));
		expect(screen.getByRole('heading', { name: 'Connect playit.gg' })).toBeInTheDocument();
		expect(await screen.findByRole('button', { name: 'Connect playit.gg' })).toBeInTheDocument();
	});

	it('goes to the router step before the PC firewall step', () => {
		renderSetup();

		fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		fireEvent.click(screen.getByRole('button', { name: 'Port forward' }));
		fireEvent.click(screen.getByRole('button', { name: 'I can change my router' }));
		expect(screen.getByRole('heading', { name: 'Forward the port on your router' })).toBeInTheDocument();
		expect(screen.getByText('TCP')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		expect(screen.getByRole('heading', { name: 'Allow the port on this PC' })).toBeInTheDocument();
	});
});
