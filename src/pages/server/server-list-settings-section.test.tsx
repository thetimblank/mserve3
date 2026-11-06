import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Toaster } from 'sonner';

import type { Server } from '@/data/servers';
import { buildCreatedServer } from '@/lib/mserve-server-mapper';
import { createDefaultServerSetupForm } from '@/lib/mserve-sync';
import { createProvider } from '@/lib/server-provider';
import { invokeMock, mockInvoke } from '@/test/tauri-mock';
import { ServerListSettingsSection } from './server-list-settings-section';

vi.mock(import('@/data/user'), async (importOriginal) => ({
	...(await importOriginal()),
	useExperience: () => ({ level: 'advanced', isBeginner: false, isAdvanced: true, atLeast: () => true }),
	useReducedMotionSetting: () => true,
}));
vi.mock('@tauri-apps/api/webview', () => ({
	getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));

/** A `\uXXXX` properties escape, spelled out. */
const escape = (hex: string) => `\\u${hex}`;
const SECTION = '\u{a7}';

const makeServer = (over: Partial<Server> = {}): Server => ({
	...buildCreatedServer(createDefaultServerSetupForm(), {
		id: 'srv',
		file: 'server.jar',
		directory: 'C:/servers/Survival',
	}),
	...over,
});

const mockPropertiesFile = (exists: boolean) =>
	mockInvoke('scan_managed_server_config_files', () => [{ fileName: 'server.properties', exists }]);

const renderSection = (server: Server, disabled = false) =>
	render(
		<>
			<ServerListSettingsSection server={server} disabled={disabled} />
			<Toaster />
		</>,
	);

describe('ServerListSettingsSection', () => {
	it('loads the MOTD from server.properties and the current icon', async () => {
		mockPropertiesFile(true);
		mockInvoke('read_managed_server_config_file', () => ({
			fileName: 'server.properties',
			content: `server-port=25565\nmotd=${escape('00A7')}aHello\\nWorld\n`,
		}));
		mockInvoke('get_server_icon', () => 'data:image/png;base64,AAAA');

		renderSection(makeServer());

		const firstLine = await screen.findByRole('textbox', { name: 'Message (MOTD) line 1' });
		await waitFor(() => expect(firstLine).toHaveTextContent('Hello'));
		expect(screen.getByRole('textbox', { name: 'Message (MOTD) line 2' })).toHaveTextContent('World');
		// The server name sits above the message, like in the multiplayer list.
		expect(screen.getByText('Survival')).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Change server icon' }).querySelector('img')).toHaveAttribute(
				'src',
				'data:image/png;base64,AAAA',
			),
		);
	});

	it('saves an edited MOTD back through apply_server_properties', async () => {
		mockPropertiesFile(true);
		mockInvoke('read_managed_server_config_file', () => ({
			fileName: 'server.properties',
			content: `motd=${escape('00A7')}aHello\\nWorld\n`,
		}));
		mockInvoke('get_server_icon', () => null);
		mockInvoke('apply_server_properties', () => undefined);

		renderSection(makeServer());
		await screen.findByRole('textbox', { name: 'Message (MOTD) line 1' });

		fireEvent.click(screen.getByRole('radio', { name: /Source/ }));
		const sourceLine = await screen.findByRole('textbox', { name: 'Message (MOTD) source line 1' });
		await waitFor(() => expect(sourceLine).toHaveValue(`${SECTION}aHello`));
		fireEvent.change(sourceLine, { target: { value: `${SECTION}aHi` } });

		fireEvent.click(await screen.findByRole('button', { name: /Save message/ }));

		await waitFor(() =>
			expect(invokeMock).toHaveBeenCalledWith('apply_server_properties', {
				payload: {
					directory: 'C:/servers/Survival',
					updates: [{ key: 'motd', value: `${escape('00A7')}aHi\\nWorld` }],
				},
			}),
		);
	});

	it('treats a server that never started (no server.properties) as an empty MOTD', async () => {
		mockPropertiesFile(false);
		mockInvoke('get_server_icon', () => null);

		renderSection(makeServer());

		const firstLine = await screen.findByRole('textbox', { name: 'Message (MOTD) line 1' });
		await waitFor(() => expect(firstLine).toHaveAttribute('contenteditable', 'true'));
		expect(firstLine).toHaveTextContent('');
		expect(screen.getByRole('button', { name: 'Add a server icon' })).toBeInTheDocument();
		expect(invokeMock).not.toHaveBeenCalledWith('read_managed_server_config_file', expect.anything());
	});

	it('keeps the editor locked when an existing server.properties cannot be read', async () => {
		mockPropertiesFile(true);
		mockInvoke('read_managed_server_config_file', () => {
			throw 'stream did not contain valid UTF-8';
		});
		mockInvoke('get_server_icon', () => null);

		renderSection(makeServer());

		expect(await screen.findByText(/stream did not contain valid UTF-8/)).toBeInTheDocument();
		expect(screen.getByRole('textbox', { name: 'Message (MOTD) line 1' })).toHaveAttribute(
			'contenteditable',
			'false',
		);
	});

	it('gives a proxy only the icon and points to its own config for the MOTD', async () => {
		mockInvoke('get_server_icon', () => null);

		renderSection(makeServer({ provider: createProvider('velocity') }));

		expect(await screen.findByText(/velocity\.toml/)).toBeInTheDocument();
		expect(screen.queryByRole('textbox', { name: 'Message (MOTD) line 1' })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Choose image/ })).toBeEnabled();
		expect(invokeMock).not.toHaveBeenCalledWith('read_managed_server_config_file', expect.anything());
	});
});
