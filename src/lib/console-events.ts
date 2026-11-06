/**
 * Turns raw server console lines into the beginner "Activity" feed: a pure
 * pattern library over the `server-output` lines the terminal hook stores
 * (`[stdout] …`, `[stderr] …`, `[system] …`, `> command`).
 *
 * Only lines matching a known pattern become events; everything else is hidden
 * from the feed (it stays in the raw console). The feed is informational: the
 * lifecycle status shown elsewhere comes from `server-runtime-state`, never from
 * these lines.
 */

export type ConsoleEventKind =
	| 'player-joined'
	| 'player-left'
	| 'chat'
	| 'server-starting'
	| 'server-ready'
	| 'server-stopping'
	| 'server-slow'
	| 'port-in-use'
	| 'eula-required'
	| 'plugin-failed'
	| 'not-whitelisted'
	| 'out-of-memory';

export type TelemetryAlertKind = 'low-tps' | 'high-ram';

export type ActivityEventKind = ConsoleEventKind | TelemetryAlertKind;

export type ActivityTone = 'info' | 'success' | 'warning' | 'error';

/** One event parsed from a single console line. */
export type ConsoleEvent = {
	kind: ConsoleEventKind;
	tone: ActivityTone;
	title: string;
	detail?: string;
	/** The player the event is about (join/leave/chat/whitelist). */
	player?: string;
	/** `HH:MM:SS` from the log header, when the line has one. */
	time: string | null;
};

/** One row of the activity feed. */
export type ActivityEvent = {
	id: string;
	kind: ActivityEventKind;
	tone: ActivityTone;
	title: string;
	detail?: string;
	player?: string;
	/** Epoch ms, or `null` when the source line carried no time. */
	at: number | null;
	/** How many identical consecutive events this row stands for. */
	count: number;
};

// `[12:34:56 INFO]: msg` (Paper/Spigot/Velocity), `[12:34:56] [Server thread/INFO]: msg`
// (vanilla/Fabric), `[06Nov2026 12:34:56.789] [Server thread/INFO] [logger/]: msg`
// (Forge/NeoForge), `[12:34:56] [Server thread/INFO] (Minecraft) msg` (Fabric).
const LOG_HEADER =
	/^\[(?:\d{1,2}[A-Za-z]{3}\d{4}\s+)?(\d{1,2}:\d{2}:\d{2})(?:[.,]\d+)?(?:\s+[A-Z]+)?\]\s*(?:\[[^\]]*\/[A-Z]+\]\s*)?(?:\[[^\]]*\]|\([^)]*\))?\s*:?\s*/;

const STREAM_PREFIX = /^\[(stdout|stderr)\]\s?/;

const PLAYER_NAME = /^[A-Za-z0-9_]{1,16}$/;

/** True for a name Minecraft accepts as a Java player name. */
export const isValidPlayerName = (name: string) => PLAYER_NAME.test(name);

/** The `whitelist add` command for a player, or `null` for an unsafe name. */
export const buildWhitelistAddCommand = (player: string): string | null =>
	isValidPlayerName(player) ? `whitelist add ${player}` : null;

type Pattern = {
	match: RegExp;
	build: (groups: RegExpMatchArray) => Omit<ConsoleEvent, 'time'>;
};

const stripPluginVersion = (value: string) => value.trim().replace(/\s+v?\d[\w.+-]*$/, '');

const formatSeconds = (raw: string) => {
	const value = Number(raw.replace(',', '.'));
	if (!Number.isFinite(value)) return null;
	return value < 10 ? value.toFixed(1) : String(Math.round(value));
};

// A leading `[Logger]` tag Paper puts after the header (`[ModernPluginLoadingStrategy] …`).
const LOGGER_TAG = String.raw`(?:\[[^\]]+\]\s*)?`;

// Order matters: chat is matched first so a player can't fake a server message
// by typing it (chat lines always start with `<name>`).
const PATTERNS: Pattern[] = [
	{
		match: /^(?:\[Not Secure\]\s*)?<([^>\s]{1,32})>\s?(.*)$/,
		build: ([, player, message]) => ({
			kind: 'chat',
			tone: 'info',
			title: player,
			detail: message,
			player,
		}),
	},
	{
		match: /^(\S{1,32})(?: \(formerly known as \S+\))? joined the game$/,
		build: ([, player]) => ({ kind: 'player-joined', tone: 'success', title: `${player} joined`, player }),
	},
	{
		match: /^(\S{1,32}) left the game$/,
		build: ([, player]) => ({ kind: 'player-left', tone: 'info', title: `${player} left`, player }),
	},
	{
		match: /^Starting minecraft server version (\S+)/,
		build: ([, version]) => ({
			kind: 'server-starting',
			tone: 'info',
			title: 'Server is starting',
			detail: `Minecraft ${version}`,
		}),
	},
	{
		match: /^Booting up Velocity (\S+?)\.*$/,
		build: ([, version]) => ({
			kind: 'server-starting',
			tone: 'info',
			title: 'Proxy is starting',
			detail: `Velocity ${version}`,
		}),
	},
	{
		match: /^Done \(([\d.,]+)s\)!/,
		build: ([, seconds]) => {
			const took = formatSeconds(seconds);
			return {
				kind: 'server-ready',
				tone: 'success',
				title: 'Server is ready',
				detail: took ? `Started in ${took} seconds. Players can join now.` : 'Players can join now.',
			};
		},
	},
	{
		match: /^(?:Stopping (?:the )?server|Shutting down the proxy)/,
		build: () => ({ kind: 'server-stopping', tone: 'info', title: 'Server is stopping' }),
	},
	{
		match: /Can't keep up! Is the server overloaded\?(?: Running (\d+)ms)?/,
		build: ([, behindMs]) => {
			const seconds = behindMs ? Number(behindMs) / 1000 : null;
			return {
				kind: 'server-slow',
				tone: 'warning',
				title: 'Server is running slow',
				detail:
					seconds != null && Number.isFinite(seconds)
						? `It fell ${seconds.toFixed(1)} seconds behind. Fewer players, plugins, or loaded chunks help.`
						: 'Fewer players, plugins, or loaded chunks help.',
			};
		},
	},
	{
		match: /FAILED TO BIND TO PORT/,
		build: () => ({
			kind: 'port-in-use',
			tone: 'error',
			title: 'The port is already in use',
			detail: 'Another program (or another server) is using this port. Stop it or pick a different port in Settings.',
		}),
	},
	{
		match: /You need to agree to the EULA in order to run the server/,
		build: () => ({
			kind: 'eula-required',
			tone: 'error',
			title: 'The Minecraft EULA is not accepted',
			detail: 'Set eula=true in eula.txt in the server folder, then start the server again.',
		}),
	},
	{
		match: new RegExp(`^${LOGGER_TAG}Could not load (?:plugin )?'(?:plugins[\\\\/])?([^']+?)(?:\\.jar)?'`),
		build: ([, plugin]) => ({
			kind: 'plugin-failed',
			tone: 'error',
			title: `Plugin ${plugin} failed to load`,
			detail: 'It may not support this server version. Check the plugin for an update.',
		}),
	},
	{
		match: new RegExp(`^${LOGGER_TAG}Error occurred while enabling (.+?) \\(Is it up to date\\?\\)`),
		build: ([, plugin]) => ({
			kind: 'plugin-failed',
			tone: 'error',
			title: `Plugin ${stripPluginVersion(plugin)} failed to start`,
			detail: 'It may not support this server version. Check the plugin for an update.',
		}),
	},
	{
		// Velocity: `Unable to load plugin plugins/Foo-1.0.jar` (a path, sometimes absolute).
		match: new RegExp(String.raw`^${LOGGER_TAG}Unable to load plugin (?:.*[\\/])?([^\\/]+?)(?:\.jar)?\s*$`),
		build: ([, plugin]) => ({
			kind: 'plugin-failed',
			tone: 'error',
			title: `Plugin ${plugin} failed to load`,
			detail: 'It may not support this Velocity version. Check the plugin for an update.',
		}),
	},
	{
		// Velocity: `Can't load plugin foo due to missing dependency bar`.
		match: new RegExp(String.raw`^${LOGGER_TAG}Can't load plugin (\S+) due to missing dependency (\S+)`),
		build: ([, plugin, dependency]) => ({
			kind: 'plugin-failed',
			tone: 'error',
			title: `Plugin ${plugin} failed to load`,
			detail: `It needs the ${dependency} plugin. Install it, or remove ${plugin}.`,
		}),
	},
	{
		// Velocity: `Can't create plugin foo`, `Can't create module for plugin foo`,
		// `Couldn't pass ProxyInitializeEvent to foo` (its startup code threw).
		match: new RegExp(
			String.raw`^${LOGGER_TAG}(?:Can't create (?:module for )?plugin|Couldn't pass ProxyInitializeEvent to) (\S+)`,
		),
		build: ([, plugin]) => ({
			kind: 'plugin-failed',
			tone: 'error',
			title: `Plugin ${plugin} failed to start`,
			detail: 'It may not support this Velocity version. Check the plugin for an update.',
		}),
	},
	{
		// `Disconnecting Steve (/1.2.3.4:5678): You are not whitelisted on this server!`
		// `Steve (/1.2.3.4:5678) lost connection: You are not white-listed on this server!`
		// `com.mojang.authlib.GameProfile@1[id=…,name=Steve,…] (/1.2.3.4:5678) lost connection: …`
		match: /^(?:\S*?name=([A-Za-z0-9_]{1,16})\b\S*|Disconnecting (\S+?)|(\S+?)) \([^)]*\)(?::| lost connection:) You are not white-?listed on this server/i,
		build: ([, profile, disconnecting, lost]) => {
			const player = profile ?? disconnecting ?? lost;
			return {
				kind: 'not-whitelisted',
				tone: 'warning',
				title: player ? `${player} is not on the whitelist` : 'A player is not on the whitelist',
				detail: 'Only whitelisted players can join this server.',
				player: player && isValidPlayerName(player) ? player : undefined,
			};
		},
	},
	{
		match: /(?:^|Exception in thread "[^"]*" |Caused by: )java\.lang\.OutOfMemoryError\b/,
		build: () => ({
			kind: 'out-of-memory',
			tone: 'error',
			title: 'Server ran out of memory',
			detail: 'Give it more RAM in Settings, or remove heavy plugins or mods.',
		}),
	},
];

/** Splits a stored console line into its log time and message. */
export const splitConsoleLine = (line: string): { stream: 'stdout' | 'stderr'; time: string | null; message: string } | null => {
	const stream = STREAM_PREFIX.exec(line);
	if (!stream) return null;
	const rest = line.slice(stream[0].length).trim();
	const header = LOG_HEADER.exec(rest);
	return {
		stream: stream[1] as 'stdout' | 'stderr',
		time: header ? header[1] : null,
		message: header ? rest.slice(header[0].length).trim() : rest,
	};
};

/**
 * Parses one stored console line into a feed event, or `null` for lines the
 * feed doesn't show (unknown output, `[system]` lines, typed commands).
 */
export const parseConsoleLine = (line: string): ConsoleEvent | null => {
	const parts = splitConsoleLine(line);
	if (!parts || !parts.message) return null;
	for (const pattern of PATTERNS) {
		const groups = parts.message.match(pattern.match);
		if (!groups) continue;
		return { ...pattern.build(groups), time: parts.time };
	}
	return null;
};

/**
 * The epoch ms for a log `HH:MM:SS` stamp, assuming the most recent such time at
 * or before `now` (a stamp later than now belongs to yesterday).
 */
export const resolveLogTimestamp = (time: string, now: Date): number | null => {
	const match = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(time);
	if (!match) return null;
	const [hours, minutes, seconds] = match.slice(1).map(Number);
	if (hours > 23 || minutes > 59 || seconds > 59) return null;
	const value = new Date(now);
	value.setHours(hours, minutes, seconds, 0);
	// A minute of slack for clock skew between the log and this machine.
	if (value.getTime() > now.getTime() + 60_000) value.setDate(value.getDate() - 1);
	return value.getTime();
};

// Repeats of these collapse into one row with a count.
const COLLAPSIBLE_KINDS = new Set<ActivityEventKind>([
	'server-slow',
	'port-in-use',
	'out-of-memory',
	'eula-required',
	'low-tps',
	'high-ram',
]);

const collapseKey = (event: Pick<ActivityEvent, 'kind' | 'title' | 'detail'>) =>
	COLLAPSIBLE_KINDS.has(event.kind) ? `${event.kind}|${event.title}` : `${event.kind}|${event.title}|${event.detail}`;

/** Pushes `event`, folding it into the previous row when it repeats it. */
const pushCollapsed = (events: ActivityEvent[], event: ActivityEvent) => {
	const previous = events[events.length - 1];
	if (previous && collapseKey(previous) === collapseKey(event)) {
		events[events.length - 1] = {
			...event,
			id: previous.id,
			at: event.at ?? previous.at,
			count: previous.count + event.count,
		};
		return;
	}
	events.push(event);
};

/**
 * Builds the feed's console events from stored terminal lines, oldest first.
 * Lines without a log time (stack traces, stderr) inherit the last seen time.
 */
export const buildConsoleActivity = (lines: readonly string[], now: Date = new Date()): ActivityEvent[] => {
	const events: ActivityEvent[] = [];
	let lastAt: number | null = null;
	lines.forEach((line, index) => {
		const parts = splitConsoleLine(line);
		if (parts?.time) lastAt = resolveLogTimestamp(parts.time, now) ?? lastAt;
		const parsed = parseConsoleLine(line);
		if (!parsed) return;
		pushCollapsed(events, {
			id: `line-${index}`,
			kind: parsed.kind,
			tone: parsed.tone,
			title: parsed.title,
			detail: parsed.detail,
			player: parsed.player,
			at: lastAt,
			count: 1,
		});
	});
	return events;
};

/**
 * Merges telemetry alerts (each with a time) into the console events by time,
 * keeping the console events' own order. Returns oldest first.
 */
export const mergeActivityEvents = (
	consoleEvents: readonly ActivityEvent[],
	alerts: readonly ActivityEvent[],
): ActivityEvent[] => {
	const sortedAlerts = [...alerts].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
	const merged: ActivityEvent[] = [];
	let alertIndex = 0;
	for (const event of consoleEvents) {
		while (
			alertIndex < sortedAlerts.length &&
			event.at != null &&
			(sortedAlerts[alertIndex].at ?? 0) < event.at
		) {
			pushCollapsed(merged, sortedAlerts[alertIndex++]);
		}
		pushCollapsed(merged, event);
	}
	while (alertIndex < sortedAlerts.length) pushCollapsed(merged, sortedAlerts[alertIndex++]);
	return merged;
};
