import type { AutoBackupMode, Server as MserveServer } from '@/data/servers';

export type ServerOutputEvent = {
	directory: string;
	stream: string;
	line: string;
};

export type ScannedBackupEntry = {
	directory: string;
	createdAt?: string;
	created_at?: string;
};

export type ScanServerContentsResult = {
	plugins: MserveServer['plugins'];
	worlds: MserveServer['worlds'];
	datapacks: MserveServer['datapacks'];
	backups: ScannedBackupEntry[];
};

export type RuntimeStatusResult = {
	running: boolean;
	exitCode: number | null;
};

export type UpdateServerSettingsPayload = {
	directory: string;
	ram: number;
	autoBackup: AutoBackupMode[];
	autoBackupInterval: number;
	autoRestart: boolean;
	jarSwapPath?: string;
	newDirectory?: string;
};

export type UpdateServerSettingsResult = {
	directory: string;
	file: string;
};

export type ServerContentTab = 'plugins' | 'worlds' | 'datapacks' | 'backups' | 'settings';

export type ServerSettingsForm = {
	ram: number;
	autoBackup: AutoBackupMode[];
	autoBackupInterval: number;
	autoRestart: boolean;
	jarSwapPath: string;
	newDirectory: string;
};
