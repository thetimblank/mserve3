import { formatDurationLong } from '@/lib/duration-utils';
import type { AutoBackupMode } from '@/lib/mserve-schema';

/**
 * The automatic backup choice as one readable line for the Review slide:
 * `Every 2 hours, when it stops`, `When it stops`, or `Off`.
 */
export const describeAutoBackup = (modes: readonly AutoBackupMode[], intervalMinutes: number) => {
	const parts: string[] = [];
	if (modes.includes('interval')) parts.push(`every ${formatDurationLong(intervalMinutes)}`);
	if (modes.includes('on_close')) parts.push('when it stops');
	if (modes.includes('on_start')) parts.push('when it starts');
	if (parts.length === 0) return 'Off';
	const line = parts.join(', ');
	return line.charAt(0).toUpperCase() + line.slice(1);
};
