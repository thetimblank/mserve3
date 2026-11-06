import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Server } from '@/data/servers';
import { buildCreatedServer } from '@/lib/mserve-server-mapper';
import { createDefaultServerSetupForm } from '@/lib/mserve-sync';
import ServerBackupsTab from './server-backups-tab';

vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn(), revealItemInDir: vi.fn() }));

const makeServer = (over: Partial<Server> = {}): Server => ({
	...buildCreatedServer(createDefaultServerSetupForm(), { id: 'srv', file: 'server.jar', directory: 'C:/servers/srv' }),
	...over,
});

const backup = (directory: string): Server['backups'][number] => ({
	directory,
	created_at: new Date('2026-01-01T12:00:00Z'),
	size: 1024,
	reason: 'manual',
});

const renderTab = (server: Server, props: Partial<React.ComponentProps<typeof ServerBackupsTab>> = {}) => {
	const handlers = {
		onCreateBackup: vi.fn(),
		onRestoreBackup: vi.fn(),
		onDeleteBackup: vi.fn(),
		onSetBackupLocked: vi.fn(),
		onSaveBackupSettings: vi.fn(async () => {}),
		onClearAllBackups: vi.fn(),
	};
	// HelpButton navigates, so it needs a router.
	render(
		<MemoryRouter>
			<ServerBackupsTab
				server={server}
				backups={server.backups}
				isBusy={false}
				isOnline={false}
				{...handlers}
				{...props}
			/>
		</MemoryRouter>,
	);
	return handlers;
};

describe('ServerBackupsTab header', () => {
	it('puts every action in one row instead of a menu', () => {
		const handlers = renderTab(makeServer({ backups: [backup('C:/servers/srv/.backups/a')] }));

		expect(screen.queryByRole('button', { name: /More backup actions/ })).not.toBeInTheDocument();
		for (const name of [/^Settings$/, /^Clear all$/, /^Create named backup$/, /^Create backup$/]) {
			expect(screen.getByRole('button', { name })).toBeEnabled();
		}

		fireEvent.click(screen.getByRole('button', { name: /^Create backup$/ }));
		expect(handlers.onCreateBackup).toHaveBeenCalledWith();
	});

	it('keeps the confirm dialog in front of Clear all', () => {
		const handlers = renderTab(makeServer({ backups: [backup('C:/servers/srv/.backups/a')] }));

		fireEvent.click(screen.getByRole('button', { name: /^Clear all$/ }));
		expect(screen.getByRole('alertdialog', { name: 'Delete all backups?' })).toBeInTheDocument();
		expect(handlers.onClearAllBackups).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: 'Clear all Backups' }));
		expect(handlers.onClearAllBackups).toHaveBeenCalledTimes(1);
	});

	it('disables Clear all when there is nothing to clear', () => {
		renderTab(makeServer({ backups: [] }));
		expect(screen.getByRole('button', { name: /^Clear all$/ })).toBeDisabled();
	});
});

describe('ServerBackupsTab empty state', () => {
	it('offers to back up now and to turn on automatic backups', () => {
		const handlers = renderTab(makeServer({ backups: [], auto_backup: [] }));

		fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
		expect(handlers.onCreateBackup).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'Turn on automatic backups' })).toBeInTheDocument();
	});

	it('points to the settings when automatic backups are already on', () => {
		renderTab(makeServer({ backups: [], auto_backup: ['on_close'] }));
		expect(screen.queryByRole('button', { name: 'Turn on automatic backups' })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Backup settings' })).toBeInTheDocument();
	});
});
