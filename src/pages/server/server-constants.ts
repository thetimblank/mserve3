import type { AutoBackupMode } from '@/data/servers';

export const backupChoices: { value: AutoBackupMode; label: string }[] = [
	{ value: 'interval', label: 'Interval' },
	{ value: 'on_close', label: 'On close' },
	{ value: 'on_start', label: 'On start' },
];
