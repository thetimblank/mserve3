import { describe, expect, it } from 'vitest';
import {
	stripAnsi,
	isJavaVersionError,
	isNoguiUnsupportedError,
	getPrimaryMinecraftVersion,
	formatBytes,
	formatUptime,
	getErrorMessage,
} from './utils';

describe('stripAnsi', () => {
	it('removes ANSI color codes', () => {
		expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello');
	});
	it('leaves plain text untouched', () => {
		expect(stripAnsi('no codes here')).toBe('no codes here');
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

describe('isNoguiUnsupportedError', () => {
	it('detects the joptsimple "is not a recognized option" message', () => {
		expect(isNoguiUnsupportedError("'nogui' is not a recognized option")).toBe(true);
		expect(isNoguiUnsupportedError('"--nogui" is not a recognized option')).toBe(true);
	});
	it('detects "Unrecognized option: --nogui"', () => {
		expect(isNoguiUnsupportedError('Unrecognized option: --nogui')).toBe(true);
	});
	it('detects "Unknown option: \'--nogui\'"', () => {
		expect(isNoguiUnsupportedError("Unknown option: '--nogui'")).toBe(true);
	});
	it('detects "no such option: --nogui"', () => {
		expect(isNoguiUnsupportedError('no such option: --nogui')).toBe(true);
	});
	it('sees through ANSI coloring', () => {
		expect(isNoguiUnsupportedError('\x1b[31mUnrecognized option: --nogui\x1b[0m')).toBe(true);
	});
	it('does not flag an unrecognized option that is not --nogui', () => {
		expect(isNoguiUnsupportedError('Unrecognized option: --forceUpgrade')).toBe(false);
	});
	it('does not flag lines that merely mention nogui', () => {
		expect(isNoguiUnsupportedError('Starting server with --nogui')).toBe(false);
		expect(isNoguiUnsupportedError('Loading properties, nogui mode enabled')).toBe(false);
	});
	it('does not flag unrelated stack traces', () => {
		expect(isNoguiUnsupportedError('java.lang.NullPointerException at Foo.bar')).toBe(false);
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

describe('formatBytes', () => {
	it('scales to the largest whole unit', () => {
		expect(formatBytes(500)).toBe('500 B');
		expect(formatBytes(1536)).toBe('1.50 KB');
		expect(formatBytes(5 * 1024 ** 3)).toBe('5.00 GB');
		expect(formatBytes(2048, { fractionDigits: 1 })).toBe('2.0 KB');
	});

	it('treats missing or negative input as zero', () => {
		expect(formatBytes(undefined)).toBe('0 B');
		expect(formatBytes(-10)).toBe('0 B');
	});
});

describe('getErrorMessage', () => {
	it('uses the string a Tauri command rejects with', () => {
		expect(getErrorMessage('Port 25565 is already in use.', 'Failed to start server.')).toBe(
			'Port 25565 is already in use.',
		);
	});

	it('uses an Error message, and falls back for anything else', () => {
		expect(getErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
		expect(getErrorMessage('  ', 'fallback')).toBe('fallback');
		expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
	});
});
