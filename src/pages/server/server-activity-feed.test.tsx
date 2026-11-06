import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invokeMock } from '@/test/tauri-mock';
import type { ActivityEvent } from '@/lib/console-events';
import ServerActivityFeed from './server-activity-feed';

const event = (over: Partial<ActivityEvent>): ActivityEvent => ({
	id: 'e1',
	kind: 'player-joined',
	tone: 'success',
	title: 'Steve joined',
	at: null,
	count: 1,
	...over,
});

const renderFeed = (props: Partial<React.ComponentProps<typeof ServerActivityFeed>> = {}) => {
	const onShowRawConsoleChange = vi.fn();
	render(
		<ServerActivityFeed
			directory='C:/servers/srv'
			events={[]}
			canSendCommands
			showRawConsole={false}
			onShowRawConsoleChange={onShowRawConsoleChange}
			{...props}>
			<div>raw terminal</div>
		</ServerActivityFeed>,
	);
	return { onShowRawConsoleChange };
};

describe('ServerActivityFeed', () => {
	it('shows an empty state before anything happens', () => {
		renderFeed();
		expect(screen.getByText('Nothing has happened yet')).toBeInTheDocument();
		expect(screen.queryByText('raw terminal')).not.toBeInTheDocument();
	});

	it('lists events with repeat counts', () => {
		renderFeed({
			events: [
				event({ id: 'a', title: 'Steve joined' }),
				event({ id: 'b', kind: 'server-slow', tone: 'warning', title: 'Server is running slow', count: 3 }),
			],
		});
		expect(screen.getByText('Steve joined')).toBeInTheDocument();
		expect(screen.getByText('×3')).toBeInTheDocument();
	});

	it('swaps in the raw console through the toggle', () => {
		const { onShowRawConsoleChange } = renderFeed();
		fireEvent.click(screen.getByRole('checkbox', { name: 'Show raw console' }));
		expect(onShowRawConsoleChange).toHaveBeenCalledWith(true);
	});

	it('renders the terminal when the raw console is on', () => {
		renderFeed({ showRawConsole: true, events: [event({})] });
		expect(screen.getByText('raw terminal')).toBeInTheDocument();
		expect(screen.queryByText('Steve joined')).not.toBeInTheDocument();
	});

	it('adds a blocked player to the whitelist', async () => {
		renderFeed({
			events: [
				event({ kind: 'not-whitelisted', tone: 'warning', title: 'Steve is not on the whitelist', player: 'Steve' }),
			],
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add to whitelist' }));
		await waitFor(() =>
			expect(invokeMock).toHaveBeenCalledWith('send_server_command', {
				directory: 'C:/servers/srv',
				command: 'whitelist add Steve',
			}),
		);
		expect(await screen.findByRole('button', { name: 'Added to whitelist' })).toBeDisabled();
	});

	it('disables the whitelist action while the server is not online', () => {
		renderFeed({
			canSendCommands: false,
			events: [event({ kind: 'not-whitelisted', title: 'Steve is not on the whitelist', player: 'Steve' })],
		});
		expect(screen.getByRole('button', { name: 'Add to whitelist' })).toBeDisabled();
	});
});
