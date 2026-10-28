import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '');

const JAVA_VERSION_ERROR_PATTERNS: RegExp[] = [
	/UnsupportedClassVersionError/i,
	/has been compiled by a more recent version of the Java Runtime/i,
	/class file version \d+(?:\.\d+)?/i,
	/requires running the server with Java \d+/i,
	/requires Java \d+ or (?:higher|newer|above)/i,
	/java\.lang\.UnsupportedClassVersionError/i,
];

/**
 * Detects the family of JVM/Minecraft errors that mean "this server was launched
 * with the wrong (too old) Java version", which drives the automatic step-down
 * retry. Deliberately conservative so unrelated stack traces don't trigger it.
 */
export const isJavaVersionError = (line: string): boolean => {
	const cleaned = stripAnsi(line);
	return JAVA_VERSION_ERROR_PATTERNS.some((pattern) => pattern.test(cleaned));
};

/** The flag as a standalone token, in either the `--nogui` or bare `nogui` spelling. */
const NOGUI_TOKEN_PATTERN = /(?:^|[^\w-])-{0,2}nogui\b/i;

const UNRECOGNIZED_OPTION_PATTERNS: RegExp[] = [
	// joptsimple (vanilla/Paper): "'nogui' is not a recognized option"
	/is not a recognized option/i,
	// picocli / Forge / getopt: "Unrecognized option: --nogui", "Unknown option: '--nogui'"
	/(?:unrecognized|unknown|unsupported|invalid|illegal)\s+(?:option|argument|flag|parameter)s?\b/i,
	/no such option/i,
];

/**
 * Detects the family of launcher errors that mean "this jar does not accept the
 * `--nogui` flag", which drives the automatic strip-and-retry. Requires *both* an
 * unrecognized-option phrase and the flag itself as a standalone token, so
 * neither a plugin complaining about some other option nor a startup line that
 * merely echoes `--nogui` can trigger a restart.
 */
export const isNoguiUnsupportedError = (line: string): boolean => {
	const cleaned = stripAnsi(line);
	if (!NOGUI_TOKEN_PATTERN.test(cleaned)) return false;
	return UNRECOGNIZED_OPTION_PATTERNS.some((pattern) => pattern.test(cleaned));
};

export const getPrimaryMinecraftVersion = (versionText: string) => {
	const match = versionText.match(/\b\d+\.\d+(?:\.\d+)?\b/);
	return match ? match[0] : null;
};

/**
 * Human-readable byte size, e.g. `1536` → `1.50 KB`. Takes an options object
 * (not a positional digit count) so it can be passed straight to chart
 * formatters that call it with `(value, index)`.
 */
export const formatBytes = (bytes?: number, options?: { fractionDigits?: number }) => {
	const value = Math.max(0, Number(bytes) || 0);
	if (value < 1024) return `${value} B`;

	const units = ['KB', 'MB', 'GB', 'TB'];
	let scaled = value / 1024;
	let unitIndex = 0;
	while (scaled >= 1024 && unitIndex < units.length - 1) {
		scaled /= 1024;
		unitIndex += 1;
	}

	return `${scaled.toFixed(options?.fractionDigits ?? 2)} ${units[unitIndex]}`;
};

/** Splits a millisecond duration into whole day/hour/minute/second components. */
export const getDurationParts = (ms: number) => ({
	days: Math.floor(ms / (1000 * 60 * 60 * 24)),
	hours: Math.floor((ms / (1000 * 60 * 60)) % 24),
	minutes: Math.floor((ms / (1000 * 60)) % 60),
	seconds: Math.floor((ms / 1000) % 60),
});

/** Compact uptime label (e.g. "3d 4h", "2h 15m", "5m", "Now") from a start date. */
export const formatUptime = (since: Date | null | undefined): string | null => {
	if (!since) return null;
	const diff = Date.now() - since.getTime();
	if (diff < 0) return 'Now';
	const { days, hours, minutes } = getDurationParts(diff);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes < 1) return 'Now';
	return `${minutes}m`;
};
