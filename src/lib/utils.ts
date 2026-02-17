import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '');

export const isServerReadyLine = (line: string) => /Done \([\d.]+s\)! For help, type "help"/i.test(line);

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

export const parseVersion = (line: string) => {
	const match = line.match(/This server is running\s+.+?\s+version\s+(.+)$/i);
	if (!match) return null;
	return match[1]?.trim() || null;
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
		cleaned.includes('This server is running') ||
		cleaned.includes('version(s) behind') ||
		cleaned.includes('Download the new version at:')
	);
};
