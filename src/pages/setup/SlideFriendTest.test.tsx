import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SlideshowProvider } from '@/components/slideshow';
import { SetupProvider } from './SetupContext';
import SlideFriendTest from './SlideFriendTest';

const updateUserField = vi.fn();
let serverStatus = 'online';

vi.mock('@/data/user', () => ({
	useUser: () => ({ user: {}, updateUserField }),
}));

vi.mock('@/data/servers', () => ({
	useServers: () => ({ servers: [{ id: 's1', name: 'Survival', status: serverStatus }] }),
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

beforeEach(() => {
	updateUserField.mockClear();
	serverStatus = 'online';
});

const renderSlide = () =>
	render(
		<MemoryRouter>
			<SlideshowProvider>
				<SetupProvider>
					<SlideFriendTest />
				</SetupProvider>
			</SlideshowProvider>
		</MemoryRouter>,
	);

describe('SlideFriendTest', () => {
	it('records the guide as completed only when the friend could join', () => {
		renderSlide();
		expect(updateUserField).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: 'It worked' }));

		expect(updateUserField).toHaveBeenCalledWith('initial_setup_hosting_tutorial_completed', true);
		const addPort = updateUserField.mock.calls.find(([key]) => key === 'completed_setup_hosting_ports')?.[1];
		expect(addPort([])).toEqual([25565]);
		expect(addPort([25565])).toEqual([25565]);
		expect(screen.getByRole('heading', { name: "You're ready" })).toBeInTheDocument();
	});

	it('explains what the friend saw and offers the tunnel when it failed', () => {
		renderSlide();

		fireEvent.click(screen.getByRole('button', { name: "It didn't work" }));

		expect(screen.getByText('"Connection refused"')).toBeInTheDocument();
		expect(screen.getByText('Common false results')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Switch to tunnel' })).toBeInTheDocument();
		expect(updateUserField).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: 'Test again' }));
		expect(screen.getByRole('heading', { name: 'Test with a friend' })).toBeInTheDocument();
	});

	it('flags when no server is online yet', () => {
		serverStatus = 'offline';
		renderSlide();
		expect(screen.getByText(/No server is online yet/)).toBeInTheDocument();
	});
});
