import { describe, expect, it } from 'vitest';
import { buildServerRunCommandPreview, isStopCommand } from './server-utils';
import { formatRamUsage } from './stats/stats-utils';

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

describe('buildServerRunCommandPreview', () => {
	it('reserves the whole fixed heap for manual RAM', () => {
		expect(buildServerRunCommandPreview({ ram: 4, file: 'paper.jar', java_executable: 'java' })).toBe(
			'java -Xmx4G -Xms4G -jar paper.jar',
		);
	});

	it('shows the elastic heap for auto RAM', () => {
		expect(
			buildServerRunCommandPreview({
				ram: 4,
				auto_heap: { initialGb: 0.75, capGb: 3 },
				file: 'paper.jar',
				custom_flags: ['--nogui'],
				java_executable: 'java',
			}),
		).toBe('java -Xmx3G -Xms768M -jar paper.jar --nogui');
	});
});

describe('formatRamUsage', () => {
	it('compares against the allocation only when there is a fixed one', () => {
		expect(formatRamUsage(1024 * 1048576, 2)).toBe('1024mb / 2048mb');
		expect(formatRamUsage(1024 * 1048576, null)).toBe('1024mb');
	});
});
