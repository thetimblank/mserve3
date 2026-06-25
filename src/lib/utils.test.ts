import { describe, expect, it } from 'vitest';
import {
	stripAnsi,
	parseListPlayers,
	isJavaVersionError,
	parseVersion,
	getPrimaryMinecraftVersion,
	formatUptime,
	shouldHideBackgroundLine,
} from './utils';

describe('stripAnsi', () => {
	it('removes ANSI color codes', () => {
		expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello');
	});
	it('leaves plain text untouched', () => {
		expect(stripAnsi('no codes here')).toBe('no codes here');
	});
});

describe('parseListPlayers', () => {
	it('parses the vanilla "list" output', () => {
		expect(parseListPlayers('There are 3 of a max of 20 players online: a, b, c')).toEqual({
			players: 3,
			capacity: 20,
		});
	});
	it('returns null for unrelated lines', () => {
		expect(parseListPlayers('Done (12.3s)! For help, type "help"')).toBeNull();
	});
});

describe('isJavaVersionError', () => {
	it('detects UnsupportedClassVersionError', () => {
		expect(isJavaVersionError('java.lang.UnsupportedClassVersionError: ...')).toBe(true);
	});
	it('detects "compiled by a more recent version" message', () => {
		expect(
			isJavaVersionError('has been compiled by a more recent version of the Java Runtime (class file version 65.0)'),
		).toBe(true);
	});
	it('detects "requires Java 21 or higher"', () => {
		expect(isJavaVersionError('This server requires Java 21 or higher.')).toBe(true);
	});
	it('does not flag unrelated stack traces', () => {
		expect(isJavaVersionError('java.lang.NullPointerException at Foo.bar')).toBe(false);
	});
	it('sees through ANSI coloring', () => {
		expect(isJavaVersionError('\x1b[31mUnsupportedClassVersionError\x1b[0m')).toBe(true);
	});
});

describe('parseVersion', () => {
	it('parses a plugin (Paper) version line', () => {
		expect(parseVersion('This server is running Paper version git-Paper-196 (MC: 1.20.1)')).toBe(
			'git-Paper-196 (MC: 1.20.1)',
		);
	});
	it('parses a vanilla name= line', () => {
		expect(parseVersion('name=1.21', 'vanilla')).toBe('1.21');
	});
	it('returns null for noise', () => {
		expect(parseVersion('some random log line')).toBeNull();
	});
});

describe('getPrimaryMinecraftVersion', () => {
	it('extracts a dotted version', () => {
		expect(getPrimaryMinecraftVersion('Paper 1.20.1 build 196')).toBe('1.20.1');
		expect(getPrimaryMinecraftVersion('1.21')).toBe('1.21');
	});
	it('returns null when absent', () => {
		expect(getPrimaryMinecraftVersion('no version')).toBeNull();
	});
});

describe('formatUptime', () => {
	it('returns null when no start date', () => {
		expect(formatUptime(null)).toBeNull();
	});
	it('formats minutes', () => {
		expect(formatUptime(new Date(Date.now() - 5 * 60_000))).toBe('5m');
	});
	it('formats hours and minutes', () => {
		expect(formatUptime(new Date(Date.now() - (2 * 3600_000 + 15 * 60_000)))).toBe('2h 15m');
	});
	it('formats days and hours', () => {
		expect(formatUptime(new Date(Date.now() - (3 * 86_400_000 + 4 * 3600_000)))).toBe('3d 4h');
	});
	it('returns "Now" for sub-minute durations', () => {
		expect(formatUptime(new Date(Date.now() - 5_000))).toBe('Now');
	});
});

describe('shouldHideBackgroundLine', () => {
	it('hides telemetry/version chatter', () => {
		expect(shouldHideBackgroundLine('There are 1 of a max of 20 players online')).toBe(true);
		expect(shouldHideBackgroundLine('TPS from last 1m, 5m, 15m: 20.0')).toBe(true);
		expect(shouldHideBackgroundLine('name=1.21')).toBe(true);
	});
	it('keeps ordinary log lines', () => {
		expect(shouldHideBackgroundLine('Player joined the game')).toBe(false);
	});
});
