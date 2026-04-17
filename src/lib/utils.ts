import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '');

type RuntimeProviderKind = 'plugin' | 'vanilla' | 'proxy' | 'unknown';

const DONE_LINE = /^Done \([\d.]+s\)!/i;

export const isServerReadyLine = (line: string, providerKind: RuntimeProviderKind = 'unknown') => {
	const cleaned = line.trim();
	if (!DONE_LINE.test(cleaned)) {
		return false;
	}

	if (providerKind === 'proxy') {
		return /^Done \([\d.]+s\)!$/i.test(cleaned);
	}

	if (providerKind === 'plugin' || providerKind === 'vanilla') {
		return /Done \([\d.]+s\)! For help, type "help"/i.test(cleaned);
	}

	return /^Done \([\d.]+s\)!(?: For help, type "help")?$/i.test(cleaned);
};

export const parseListPlayers = (line: string) => {
	const match = line.match(/There are\s+(\d+)\s+of a max of\s+(\d+)\s+players online/i);
	if (!match) return null;
	return {
		players: Number(match[1]),
		capacity: Number(match[2]),
	};
};

export const parseTps = (line: string) => {
	const match = line.match(
		/TPS from last 1m, 5m, 15m:\s*([0-9]+(?:\.[0-9]+)?),\s*([0-9]+(?:\.[0-9]+)?),\s*([0-9]+(?:\.[0-9]+)?)/i,
	);
	if (!match) return null;
	return {
		tps: Number(match[1]),
	};
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
