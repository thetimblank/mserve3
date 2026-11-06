import { describe, expect, it } from 'vitest';
import {
	BROADCAST_MAX_LENGTH,
	buildBroadcastCommand,
	buildKeepInventoryCommand,
	buildPlayerActionCommand,
	buildWorldActionCommand,
	describePlayerAction,
	isPlayerActionAvailable,
	sanitizeBroadcastText,
	supportsModernCommands,
	type GameMode,
} from './player-actions';

describe('buildPlayerActionCommand', () => {
	it('builds each player command', () => {
		expect(buildPlayerActionCommand({ kind: 'op' }, 'Steve')).toBe('op Steve');
		expect(buildPlayerActionCommand({ kind: 'deop' }, 'Steve')).toBe('deop Steve');
		expect(buildPlayerActionCommand({ kind: 'kick' }, 'Steve')).toBe('kick Steve');
		expect(buildPlayerActionCommand({ kind: 'ban' }, 'Steve')).toBe('ban Steve');
		expect(buildPlayerActionCommand({ kind: 'pardon' }, 'Steve')).toBe('pardon Steve');
		expect(buildPlayerActionCommand({ kind: 'whitelist-add' }, 'Steve')).toBe('whitelist add Steve');
		expect(buildPlayerActionCommand({ kind: 'lightning' }, 'Steve')).toBe(
			'execute at Steve run summon lightning_bolt',
		);
		expect(buildPlayerActionCommand({ kind: 'heal' }, 'Steve')).toBe('effect give Steve instant_health 1 10');
		expect(buildPlayerActionCommand({ kind: 'gamemode', mode: 'creative' }, 'Steve')).toBe(
			'gamemode creative Steve',
		);
	});

	it('refuses names that could inject another command', () => {
		for (const name of ['', 'two words', 'Steve\nstop', 'a;op b', 'Stéve', 'a_very_long_name_17']) {
			expect(buildPlayerActionCommand({ kind: 'op' }, name)).toBeNull();
		}
	});

	it('refuses an unknown game mode', () => {
		expect(buildPlayerActionCommand({ kind: 'gamemode', mode: 'hardcore' as GameMode }, 'Steve')).toBeNull();
	});

	it('describes what happened', () => {
		expect(describePlayerAction({ kind: 'gamemode', mode: 'spectator' }, 'Alex')).toBe(
			'Alex is now in Spectator mode.',
		);
		expect(describePlayerAction({ kind: 'lightning' }, 'Alex')).toBe('Struck Alex with lightning.');
	});
});

describe('supportsModernCommands', () => {
	it('splits at Minecraft 1.13', () => {
		expect(supportsModernCommands('1.12.2')).toBe(false);
		expect(supportsModernCommands('1.8.9')).toBe(false);
		expect(supportsModernCommands('1.13')).toBe(true);
		expect(supportsModernCommands('1.21.11')).toBe(true);
		expect(supportsModernCommands('Paper 1.20.4')).toBe(true);
	});

	it('treats year-based and unknown versions as modern', () => {
		expect(supportsModernCommands('26.1')).toBe(true);
		expect(supportsModernCommands(null)).toBe(true);
		expect(supportsModernCommands('snapshot')).toBe(true);
	});

	it('hides lightning and heal on old servers only', () => {
		expect(isPlayerActionAvailable('lightning', false)).toBe(false);
		expect(isPlayerActionAvailable('heal', false)).toBe(false);
		expect(isPlayerActionAvailable('kick', false)).toBe(true);
		expect(isPlayerActionAvailable('heal', true)).toBe(true);
	});
});

describe('broadcast', () => {
	it('turns line breaks and control characters into spaces', () => {
		expect(sanitizeBroadcastText('hello\nstop')).toBe('hello stop');
		const nul = String.fromCharCode(0);
		const lineSeparator = String.fromCharCode(0x2028);
		expect(sanitizeBroadcastText(`x${nul}y${lineSeparator}z`)).toBe('x y z');
		expect(buildBroadcastCommand('Server restarts\nin 5 minutes')).toBe('say Server restarts in 5 minutes');
	});

	it('caps the length and skips empty text', () => {
		expect(sanitizeBroadcastText('x'.repeat(400))).toHaveLength(BROADCAST_MAX_LENGTH);
		expect(buildBroadcastCommand(' \n\t ')).toBeNull();
	});
});

describe('world commands', () => {
	it('builds the world row commands', () => {
		expect(buildWorldActionCommand('day')).toBe('time set day');
		expect(buildWorldActionCommand('night')).toBe('time set night');
		expect(buildWorldActionCommand('clear-weather')).toBe('weather clear');
		expect(buildWorldActionCommand('save')).toBe('save-all');
	});

	it('sets keep inventory with the rule name the server understood', () => {
		expect(buildKeepInventoryCommand('keepInventory', true)).toBe('gamerule keepInventory true');
		expect(buildKeepInventoryCommand('keep_inventory', false)).toBe('gamerule keep_inventory false');
		expect(buildKeepInventoryCommand('keepInventory true\nstop', true)).toBeNull();
	});
});
