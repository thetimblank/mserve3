import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Server } from '@/data/servers';
import { createProvider } from '@/lib/server-provider';
import type { ProviderName } from '@/lib/mserve-schema';
import SecurityPluginGuide from './security-plugin-guide';

const serverWith = (provider: ProviderName) =>
	({ id: 'srv-1', provider: createProvider(provider) }) as unknown as Server;

const renderGuide = (provider: ProviderName) =>
	render(
		<MemoryRouter>
			<SecurityPluginGuide server={serverWith(provider)} />
		</MemoryRouter>,
	);

describe('SecurityPluginGuide', () => {
	it('links a plugin server to its Plugins tab', () => {
		renderGuide('paper');
		expect(screen.getByRole('heading', { name: 'Protect your server with plugins' })).toBeTruthy();
		expect(screen.getByRole('link', { name: /Browse plugins/ }).getAttribute('href')).toBe(
			'/servers/srv-1/plugins',
		);
		expect(screen.getByText('Anti-cheat')).toBeTruthy();
		expect(screen.getByText('Anti-bot')).toBeTruthy();
		expect(screen.getByText('Other security')).toBeTruthy();
	});

	it('talks about mods on a modded server', () => {
		renderGuide('fabric');
		expect(screen.getByRole('link', { name: /Browse mods/ }).getAttribute('href')).toBe('/servers/srv-1/mods');
	});

	it('renders nothing on vanilla, which loads neither', () => {
		const { container } = renderGuide('vanilla');
		expect(container.firstChild).toBeNull();
	});
});
