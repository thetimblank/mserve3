import React from 'react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import {
	type SettingsGroup,
	type SettingsSection,
	SettingsLayout,
	groupSettingsSections,
	matchesSettingsSection,
} from './settings-layout';

const GROUPS: SettingsGroup[] = [
	{ id: 'app', title: 'App' },
	{ id: 'servers', title: 'Servers' },
	{ id: 'danger' },
];

const section = (id: string, group: string, title: string, keywords: string[] = []): SettingsSection => ({
	id,
	group,
	title,
	description: `${title} description`,
	keywords,
	render: () => <p>{`${title} body`}</p>,
});

const SECTIONS: SettingsSection[] = [
	section('appearance', 'app', 'Appearance', ['theme', 'dark']),
	section('updates', 'app', 'Updates', ['version']),
	section('java', 'servers', 'Java defaults', ['jdk']),
	section('danger-zone', 'danger', 'Danger Zone', ['delete']),
];

let navigateTo: ((to: string) => void) | null = null;
const NavigateCapture: React.FC = () => {
	const navigate = useNavigate();
	navigateTo = (to) => navigate(to);
	return <output data-testid='hash'>{useLocation().hash}</output>;
};

const renderLayout = (
	props: Partial<React.ComponentProps<typeof SettingsLayout>> = {},
	initialEntry = '/settings',
) =>
	render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<NavigateCapture />
			<SettingsLayout groups={GROUPS} sections={SECTIONS} {...props} />
		</MemoryRouter>,
	);

const nav = () => screen.getByRole('navigation', { name: 'Settings sections' });
const search = () => screen.getByRole('textbox', { name: 'Search settings' });
const pageTitle = () => screen.getByRole('heading', { level: 2 });

describe('matchesSettingsSection', () => {
	it('matches title, description, and keywords case-insensitively', () => {
		const target = SECTIONS[0];
		expect(matchesSettingsSection(target, '')).toBe(true);
		expect(matchesSettingsSection(target, '  APPEAR ')).toBe(true);
		expect(matchesSettingsSection(target, 'description')).toBe(true);
		expect(matchesSettingsSection(target, 'dark')).toBe(true);
		expect(matchesSettingsSection(target, 'jdk')).toBe(false);
	});
});

describe('groupSettingsSections', () => {
	it('buckets matches by group in group order, keeping empty groups', () => {
		const grouped = groupSettingsSections(GROUPS, SECTIONS, 'version');
		expect(grouped.map((entry) => entry.group.id)).toEqual(['app', 'servers', 'danger']);
		expect(grouped.map((entry) => entry.sections.map((item) => item.id))).toEqual([['updates'], [], []]);
	});
});

describe('SettingsLayout', () => {
	it('lists groups with headings and opens the first section by default', () => {
		renderLayout();

		expect(within(nav()).getByText('App')).toBeInTheDocument();
		expect(within(nav()).getByText('Servers')).toBeInTheDocument();
		expect(pageTitle()).toHaveTextContent('Appearance');
		expect(screen.getByText('Appearance description')).toBeInTheDocument();
		expect(screen.getByText('Appearance body')).toBeInTheDocument();
		expect(within(nav()).getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
	});

	it('switches the page when a section is clicked', () => {
		renderLayout();

		fireEvent.click(within(nav()).getByRole('button', { name: 'Java defaults' }));

		expect(pageTitle()).toHaveTextContent('Java defaults');
		expect(screen.getByText('Java defaults body')).toBeInTheDocument();
		expect(screen.queryByText('Appearance body')).not.toBeInTheDocument();
		expect(screen.getByTestId('hash')).toHaveTextContent('#java');
	});

	it('opens the section named by the URL hash, and follows hash changes', () => {
		renderLayout({}, '/settings#java');
		expect(pageTitle()).toHaveTextContent('Java defaults');

		act(() => navigateTo?.('/settings#updates'));
		expect(pageTitle()).toHaveTextContent('Updates');
	});

	it('keeps a pending deep link when a search changes the page', () => {
		renderLayout({}, '/settings#server-properties');

		fireEvent.change(search(), { target: { value: 'jdk' } });
		fireEvent.change(search(), { target: { value: '' } });

		expect(screen.getByTestId('hash')).toHaveTextContent('#server-properties');
		expect(pageTitle()).toHaveTextContent('Appearance');
	});

	it('falls back to the first section for an unknown hash, then opens it once it exists', () => {
		const { rerender } = renderLayout({}, '/settings#server-properties');
		expect(pageTitle()).toHaveTextContent('Appearance');

		rerender(
			<MemoryRouter initialEntries={['/settings#server-properties']}>
				<NavigateCapture />
				<SettingsLayout
					groups={GROUPS}
					sections={[...SECTIONS, section('server-properties', 'servers', 'server.properties')]}
				/>
			</MemoryRouter>,
		);
		expect(pageTitle()).toHaveTextContent('server.properties');
	});

	it('searches across groups, hides empty groups, and keeps the match after clearing', () => {
		renderLayout();

		fireEvent.change(search(), { target: { value: 'jdk' } });

		expect(within(nav()).queryByText('App')).not.toBeInTheDocument();
		expect(within(nav()).getByText('Servers')).toBeInTheDocument();
		expect(within(nav()).getAllByRole('button')).toHaveLength(1);
		expect(pageTitle()).toHaveTextContent('Java defaults');

		fireEvent.change(search(), { target: { value: '' } });
		expect(within(nav()).getAllByRole('button')).toHaveLength(SECTIONS.length);
		expect(pageTitle()).toHaveTextContent('Java defaults');
	});

	it('shows a no-results state that clears the search', () => {
		renderLayout();

		fireEvent.change(search(), { target: { value: 'nothing-matches-this' } });

		expect(screen.getByText('No settings found')).toBeInTheDocument();
		expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
		expect(search()).toHaveValue('');
		expect(pageTitle()).toHaveTextContent('Appearance');
	});

	it('shows a group loading row while not searching', () => {
		renderLayout({
			groups: [...GROUPS, { id: 'config-files', title: 'Config files', loadingLabel: 'Detecting config files...' }],
		});

		expect(within(nav()).getByText('Config files')).toBeInTheDocument();
		expect(within(nav()).getByText('Detecting config files...')).toBeInTheDocument();

		fireEvent.change(search(), { target: { value: 'appearance' } });
		expect(within(nav()).queryByText('Detecting config files...')).not.toBeInTheDocument();
	});

	it('renders the overlay for the active section only when it returns content', () => {
		renderLayout({
			renderOverlay: (active) => (active.id === 'java' ? <p>Locked notice</p> : null),
		});

		expect(screen.queryByText('Locked notice')).not.toBeInTheDocument();
		fireEvent.click(within(nav()).getByRole('button', { name: 'Java defaults' }));
		expect(screen.getByText('Locked notice')).toBeInTheDocument();
	});

	it('disables search and navigation when navigation is disabled', () => {
		renderLayout({ navigationDisabled: true });

		expect(search()).toBeDisabled();
		for (const button of within(nav()).getAllByRole('button')) {
			expect(button).toBeDisabled();
		}
	});
});
