import { describe, expect, it } from 'vitest';
import {
	buildConsoleActivity,
	buildWhitelistAddCommand,
	mergeActivityEvents,
	parseConsoleLine,
	resolveLogTimestamp,
	type ActivityEvent,
} from './console-events';

const paper = (message: string, level = 'INFO') => `[stdout] [12:34:56 ${level}]: ${message}`;
const vanilla = (message: string, level = 'INFO') => `[stdout] [12:34:56] [Server thread/${level}]: ${message}`;

describe('parseConsoleLine', () => {
	it('reads the time from Paper, vanilla, Fabric and Forge headers', () => {
		expect(parseConsoleLine(paper('Steve joined the game'))?.time).toBe('12:34:56');
		expect(parseConsoleLine(vanilla('Steve joined the game'))?.time).toBe('12:34:56');
		expect(
			parseConsoleLine('[stdout] [12:34:56] [Server thread/INFO] (Minecraft) Steve joined the game')?.kind,
		).toBe('player-joined');
		expect(
			parseConsoleLine(
				'[stdout] [06Nov2026 12:34:56.789] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: Steve joined the game',
			),
		).toMatchObject({ kind: 'player-joined', time: '12:34:56' });
	});

	it('parses joins and leaves', () => {
		expect(parseConsoleLine(paper('Steve joined the game'))).toMatchObject({
			kind: 'player-joined',
			title: 'Steve joined',
			player: 'Steve',
		});
		expect(parseConsoleLine(vanilla('Alex left the game'))).toMatchObject({ kind: 'player-left', player: 'Alex' });
		expect(parseConsoleLine(vanilla('Steve (formerly known as Bob) joined the game'))?.player).toBe('Steve');
	});

	it('parses chat, including unsigned chat', () => {
		expect(parseConsoleLine(paper('<Steve> hello there'))).toMatchObject({
			kind: 'chat',
			title: 'Steve',
			detail: 'hello there',
		});
		expect(parseConsoleLine(vanilla('[Not Secure] <Alex> hi'))).toMatchObject({ kind: 'chat', player: 'Alex' });
	});

	it("doesn't let chat fake a server message", () => {
		expect(parseConsoleLine(paper('<Steve> Done (1.0s)! For help, type "help"'))?.kind).toBe('chat');
		expect(parseConsoleLine(paper('<Steve> Bob joined the game'))?.kind).toBe('chat');
	});

	it('parses the start, ready and stop lines', () => {
		expect(parseConsoleLine(vanilla('Starting minecraft server version 1.21.4'))).toMatchObject({
			kind: 'server-starting',
			detail: 'Minecraft 1.21.4',
		});
		expect(parseConsoleLine(paper('Done (12.345s)! For help, type "help"'))).toMatchObject({
			kind: 'server-ready',
			tone: 'success',
			detail: 'Started in 12 seconds. Players can join now.',
		});
		expect(parseConsoleLine(paper('Done (3.20s)!'))?.detail).toContain('3.2 seconds');
		expect(parseConsoleLine(vanilla('Stopping server'))?.kind).toBe('server-stopping');
		expect(parseConsoleLine(paper('Stopping the server'))?.kind).toBe('server-stopping');
		expect(parseConsoleLine(paper('Booting up Velocity 3.4.0...'))).toMatchObject({
			kind: 'server-starting',
			detail: 'Velocity 3.4.0',
		});
	});

	it('turns "Can\'t keep up!" into a running-slow warning', () => {
		expect(
			parseConsoleLine(vanilla("Can't keep up! Is the server overloaded? Running 2034ms or 40 ticks behind", 'WARN')),
		).toMatchObject({ kind: 'server-slow', tone: 'warning', title: 'Server is running slow' });
	});

	it('recognises startup failures', () => {
		expect(parseConsoleLine(vanilla('**** FAILED TO BIND TO PORT!', 'WARN'))?.kind).toBe('port-in-use');
		expect(
			parseConsoleLine(vanilla('You need to agree to the EULA in order to run the server. Go to eula.txt for more info.')),
		)?.toMatchObject({ kind: 'eula-required', tone: 'error' });
	});

	it('recognises plugins that fail to load or enable', () => {
		expect(
			parseConsoleLine(paper("Could not load 'plugins/Foo.jar' in folder 'plugins'", 'ERROR')),
		).toMatchObject({ kind: 'plugin-failed', title: 'Plugin Foo failed to load' });
		expect(
			parseConsoleLine(
				paper("[ModernPluginLoadingStrategy] Could not load plugin 'Bar.jar' in folder 'plugins'", 'ERROR'),
			)?.title,
		).toBe('Plugin Bar failed to load');
		expect(
			parseConsoleLine(paper('Error occurred while enabling Essentials v2.20.1 (Is it up to date?)', 'ERROR'))?.title,
		).toBe('Plugin Essentials failed to start');
	});

	it('extracts the player from every not-whitelisted format', () => {
		const lines = [
			vanilla('Disconnecting Steve (/127.0.0.1:52134): You are not white-listed on this server!'),
			paper('Steve (/127.0.0.1:52134) lost connection: You are not whitelisted on this server!'),
			vanilla(
				'com.mojang.authlib.GameProfile@1a2b3c[id=<null>,name=Steve,properties={},legacy=false] (/127.0.0.1:52134) lost connection: You are not white-listed on this server!',
			),
		];
		for (const line of lines) {
			expect(parseConsoleLine(line)).toMatchObject({
				kind: 'not-whitelisted',
				title: 'Steve is not on the whitelist',
				player: 'Steve',
			});
		}
	});

	it('drops an unsafe name from the whitelist event', () => {
		const event = parseConsoleLine(
			paper('.BedrockGuy (/127.0.0.1:1) lost connection: You are not whitelisted on this server!'),
		);
		expect(event?.kind).toBe('not-whitelisted');
		expect(event?.player).toBeUndefined();
	});

	it('recognises out-of-memory errors, with or without a header', () => {
		expect(parseConsoleLine('[stderr] java.lang.OutOfMemoryError: Java heap space')?.kind).toBe('out-of-memory');
		expect(
			parseConsoleLine('[stderr] Exception in thread "Server thread" java.lang.OutOfMemoryError: Java heap space')?.kind,
		).toBe('out-of-memory');
		expect(parseConsoleLine(paper('<Steve> java.lang.OutOfMemoryError'))?.kind).toBe('chat');
	});

	it('hides unknown output, system lines and typed commands', () => {
		expect(parseConsoleLine(paper('Preparing level "world"'))).toBeNull();
		expect(parseConsoleLine(paper('Loaded 7 recipes'))).toBeNull();
		expect(parseConsoleLine('[system] Running: java -jar server.jar')).toBeNull();
		expect(parseConsoleLine('> say hi')).toBeNull();
		expect(parseConsoleLine('[stdout] ')).toBeNull();
	});
});

describe('buildWhitelistAddCommand', () => {
	it('builds the command only for valid player names', () => {
		expect(buildWhitelistAddCommand('Steve_01')).toBe('whitelist add Steve_01');
		expect(buildWhitelistAddCommand('bad name')).toBeNull();
		expect(buildWhitelistAddCommand('x\nop Steve')).toBeNull();
		expect(buildWhitelistAddCommand('a'.repeat(17))).toBeNull();
	});
});

describe('resolveLogTimestamp', () => {
	const now = new Date(2026, 10, 6, 14, 0, 0);

	it('uses today for a time at or before now', () => {
		expect(resolveLogTimestamp('13:59:00', now)).toBe(new Date(2026, 10, 6, 13, 59, 0).getTime());
	});

	it('uses yesterday for a time later than now', () => {
		expect(resolveLogTimestamp('23:30:00', now)).toBe(new Date(2026, 10, 5, 23, 30, 0).getTime());
	});

	it('rejects malformed times', () => {
		expect(resolveLogTimestamp('25:00:00', now)).toBeNull();
		expect(resolveLogTimestamp('noon', now)).toBeNull();
	});
});

describe('buildConsoleActivity', () => {
	const now = new Date(2026, 10, 6, 14, 0, 0);

	it('keeps only known events, oldest first, with times', () => {
		const events = buildConsoleActivity(
			[
				'[stdout] [13:00:00 INFO]: Starting minecraft server version 1.21.4',
				'[stdout] [13:00:01 INFO]: Preparing level "world"',
				'[stdout] [13:00:10 INFO]: Done (9.000s)! For help, type "help"',
				'[stdout] [13:05:00 INFO]: Steve joined the game',
			],
			now,
		);
		expect(events.map((event) => event.kind)).toEqual(['server-starting', 'server-ready', 'player-joined']);
		expect(events[2].at).toBe(new Date(2026, 10, 6, 13, 5, 0).getTime());
	});

	it('gives header-less lines the last seen time', () => {
		const events = buildConsoleActivity(
			['[stdout] [13:10:00 ERROR]: Encountered an unexpected exception', '[stderr] java.lang.OutOfMemoryError: Java heap space'],
			now,
		);
		expect(events).toHaveLength(1);
		expect(events[0].at).toBe(new Date(2026, 10, 6, 13, 10, 0).getTime());
	});

	it('collapses repeated warnings into one row with a count', () => {
		const slow = (time: string, ms: number) =>
			`[stdout] [${time} WARN]: Can't keep up! Is the server overloaded? Running ${ms}ms or 40 ticks behind`;
		const events = buildConsoleActivity([slow('13:00:00', 2000), slow('13:01:00', 3000), slow('13:02:00', 4000)], now);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: 'server-slow', count: 3, id: 'line-0' });
		expect(events[0].detail).toContain('4.0 seconds');
	});

	it("doesn't collapse different chat messages", () => {
		const events = buildConsoleActivity(
			['[stdout] [13:00:00 INFO]: <Steve> hi', '[stdout] [13:00:01 INFO]: <Steve> how are you'],
			now,
		);
		expect(events).toHaveLength(2);
	});
});

describe('mergeActivityEvents', () => {
	const event = (id: string, at: number | null): ActivityEvent => ({
		id,
		kind: 'chat',
		tone: 'info',
		title: id,
		detail: id,
		at,
		count: 1,
	});
	const alert = (id: string, at: number): ActivityEvent => ({ ...event(id, at), kind: 'low-tps', title: id });

	it('places alerts between console events by time', () => {
		const merged = mergeActivityEvents([event('a', 100), event('b', 300)], [alert('x', 400), alert('y', 200)]);
		expect(merged.map((item) => item.id)).toEqual(['a', 'y', 'b', 'x']);
	});

	it('keeps untimed console events before any alert', () => {
		const merged = mergeActivityEvents([event('a', null), event('b', 300)], [alert('x', 100)]);
		expect(merged.map((item) => item.id)).toEqual(['a', 'x', 'b']);
	});
});
