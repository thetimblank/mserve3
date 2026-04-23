import { invoke } from '@tauri-apps/api/core';

export const getDefaultServersRootPath = async () => {
	const value = await invoke<string>('get_default_servers_root_path');
	return value.trim();
};
