import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '');

type RuntimeProviderKind = 'plugin' | 'vanilla' | 'proxy' | 'unknown';

export const parseListPlayers = (line: string) => {
	const match = line.match(/There are\s+(\d+)\s+of a max of\s+(\d+)\s+players online/i);
	if (!match) return null;
	return {
		players: Number(match[1]),
		capacity: Number(match[2]),
	};
};

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

export const parseVersion = (line: string, providerKind: RuntimeProviderKind = 'unknown') => {
	const pluginMatch = line.match(/This server is running\s+.+?\s+version\s+(.+)$/i);
	if (pluginMatch) {
		return pluginMatch[1]?.trim() || null;
	}

	if (providerKind === 'vanilla' || providerKind === 'unknown') {
		const vanillaName = line.match(/\bname\s*=\s*(.+)$/i);
		if (vanillaName) {
			return vanillaName[1]?.trim() || null;
		}

		const vanillaId = line.match(/\bid\s*=\s*(.+)$/i);
		if (vanillaId) {
			return vanillaId[1]?.trim() || null;
		}
	}

	return null;
};

export const getPrimaryMinecraftVersion = (versionText: string) => {
	const match = versionText.match(/\b\d+\.\d+(?:\.\d+)?\b/);
	return match ? match[0] : null;
};

/** Compact uptime label (e.g. "3d 4h", "2h 15m", "5m", "Now") from a start date. */
export const formatUptime = (since: Date | null | undefined): string | null => {
	if (!since) return null;
	const diff = Date.now() - since.getTime();
	if (diff < 0) return 'Now';
	const days = Math.floor(diff / (1000 * 60 * 60 * 24));
	const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
	const minutes = Math.floor((diff / (1000 * 60)) % 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes < 1) return 'Now';
	return `${minutes}m`;
};

export const shouldHideBackgroundLine = (cleaned: string) => {
	return (
		cleaned.includes('There are') ||
		cleaned.includes('TPS from last 1m, 5m, 15m:') ||
		cleaned.includes('Checking version, please wait...') ||
		cleaned.includes('Server version info:') ||
		cleaned.includes('This server is running') ||
		/\b(?:id|name|data|series|protocol|build_time|pack_resource|pack_data|stable)\s*=\s*/i.test(cleaned) ||
		cleaned.includes('version(s) behind') ||
		cleaned.includes('Download the new version at:')
	);
};
