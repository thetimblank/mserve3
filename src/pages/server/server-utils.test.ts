import { describe, expect, it } from 'vitest';
import { isStopCommand } from './server-utils';

describe('isStopCommand', () => {
	it('treats only a bare stop as a game-server shutdown', () => {
		expect(isStopCommand('stop')).toBe(true);
		expect(isStopCommand('/STOP ', 'paper')).toBe(true);
		expect(isStopCommand('stop now', 'paper')).toBe(false);
		expect(isStopCommand('end', 'paper')).toBe(false);
	});

	it('recognizes BungeeCord end, with an optional reason', () => {
		expect(isStopCommand('end', 'bungeecord')).toBe(true);
		expect(isStopCommand('end Maintenance', 'bungeecord')).toBe(true);
		expect(isStopCommand('stop', 'bungeecord')).toBe(false);
	});

	it('recognizes Velocity shutdown and its aliases', () => {
		expect(isStopCommand('shutdown', 'velocity')).toBe(true);
		expect(isStopCommand('end', 'velocity')).toBe(true);
		expect(isStopCommand('stop', 'velocity')).toBe(true);
		expect(isStopCommand('glist', 'velocity')).toBe(false);
	});
});
