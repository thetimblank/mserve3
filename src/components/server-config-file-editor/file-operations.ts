import { invoke } from '@tauri-apps/api/core';

import type {
	ManagedConfigFileReadPayload,
	ManagedConfigFileReadResult,
	ManagedConfigFileWritePayload,
} from '@/lib/server-config-files';

export const readManagedConfigFile = (directory: string, fileName: string) => {
	const payload: ManagedConfigFileReadPayload = { directory, fileName };
	return invoke<ManagedConfigFileReadResult>('read_managed_server_config_file', { payload });
};

export const writeManagedConfigFile = (directory: string, fileName: string, content: string) => {
	const payload: ManagedConfigFileWritePayload = { directory, fileName, content };
	return invoke<ManagedConfigFileReadResult>('write_managed_server_config_file', { payload });
};

export const getManagedConfigToastId = (serverDirectory: string, fileName: string) =>
	`managed-config-${serverDirectory}-${fileName}`;
