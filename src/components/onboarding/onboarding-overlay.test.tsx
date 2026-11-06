import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { ThemeProvider } from '@/components/theme-provider';
import { UserProvider } from '@/data/user';
import { parseCreateServerPreset } from '@/pages/create-server/create-server-flow';
import { ONBOARDING_GOAL_DESTINATIONS, OnboardingOverlay } from './onboarding-overlay';

const USER_STORAGE_KEY = 'mserve.user.v1';

/** Prints where the tour sent us, so tests can assert path and router state. */
const LocationProbe = () => {
	const location = useLocation();
	return (
		<div data-testid='location'>
			{location.pathname} {JSON.stringify(location.state ?? null)}
		</div>
	);
};

const renderTour = () =>
	render(
		<MemoryRouter initialEntries={['/']}>
			<ThemeProvider defaultTheme='dark' storageKey='test-theme'>
				<UserProvider>
					<OnboardingOverlay />
					<Routes>
						<Route path='*' element={<LocationProbe />} />
					</Routes>
				</UserProvider>
			</ThemeProvider>
		</MemoryRouter>,
	);

const storedUser = () => JSON.parse(localStorage.getItem(USER_STORAGE_KEY) ?? '{}');

/** Clicks Continue until the last slide (the goal slide has no Continue). */
const continueToEnd = () => {
	let button = screen.queryByRole('button', { name: /Continue/ });
	while (button) {
		fireEvent.click(button);
		button = screen.queryByRole('button', { name: /Continue/ });
	}
};

/** Clicks Get started, then Continue through every slide up to the goal slide. */
const goToGoalSlide = async () => {
	fireEvent.click(await screen.findByRole('button', { name: /Get started/ }));
	continueToEnd();
	return screen.findByRole('heading', { name: 'What do you want to build first?' });
};

afterEach(() => {
	localStorage.clear();
});

describe('OnboardingOverlay', () => {
	it('offers Skip tour under Get started and finishes without navigating', async () => {
		renderTour();

		fireEvent.click(await screen.findByRole('button', { name: 'Skip tour' }));

		expect(screen.queryByRole('heading', { name: 'Welcome to mserve' })).not.toBeInTheDocument();
		expect(screen.getByTestId('location')).toHaveTextContent('/ null');
		expect(storedUser().onboarding_completed).toBe(true);
	});

	it('shows a live quick-help button before the goal slide', async () => {
		renderTour();

		fireEvent.click(await screen.findByRole('button', { name: /Get started/ }));
		fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
		fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

		expect(screen.getByRole('heading', { name: 'Help is one click away' })).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /Learn about Server memory/ }));
		expect(await screen.findByRole('dialog')).toBeInTheDocument();
	});

	it('opens the wizard with Vanilla preselected for Survival Multiplayer', async () => {
		renderTour();
		await goToGoalSlide();

		fireEvent.click(screen.getByRole('button', { name: /Survival Multiplayer/ }));

		expect(screen.getByTestId('location')).toHaveTextContent('/servers/new {"provider":"vanilla"}');
		expect(storedUser().onboarding_completed).toBe(true);
	});

	it('sends the network goal to Networks with no preset', async () => {
		renderTour();
		await goToGoalSlide();

		fireEvent.click(screen.getByRole('button', { name: /multi-server network/ }));

		expect(screen.getByTestId('location')).toHaveTextContent('/network null');
	});

	it('saves the experience level picked during the tour', async () => {
		renderTour();

		fireEvent.click(await screen.findByRole('button', { name: /Get started/ }));
		fireEvent.click(screen.getByRole('button', { name: /Beginner/ }));
		continueToEnd();
		fireEvent.click(await screen.findByRole('button', { name: /Just looking around/ }));

		expect(storedUser()).toMatchObject({ experience_level: 'beginner', onboarding_completed: true });
		expect(screen.getByTestId('location')).toHaveTextContent('/ null');
	});
});

describe('ONBOARDING_GOAL_DESTINATIONS', () => {
	it('maps every wizard goal to a preset the wizard accepts', () => {
		expect(parseCreateServerPreset(ONBOARDING_GOAL_DESTINATIONS.survival.state)).toEqual({
			source: 'software',
			provider: 'vanilla',
		});
		expect(parseCreateServerPreset(ONBOARDING_GOAL_DESTINATIONS.modded.state)).toEqual({
			source: 'software',
			provider: 'fabric',
		});
		expect(parseCreateServerPreset(ONBOARDING_GOAL_DESTINATIONS.plugins.state)).toEqual({
			source: 'software',
			provider: 'paper',
		});
	});
});
