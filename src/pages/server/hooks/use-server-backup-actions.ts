import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { AutoBackupMode, Server, ServerUpdate } from '@/data/servers';
import { getBackupNameFromPath } from '../server-utils';
import type { CreateServerBackupResult, RestoreServerBackupResult } from '../server-types';

const BACKUP_STORAGE_LIMIT_ERROR_PREFIX = 'Backup storage limit exceeded';

const toErrorMessage = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback;

const isBackupStorageLimitError = (message: string) => message.startsWith(BACKUP_STORAGE_LIMIT_ERROR_PREFIX);

const notifyDeletedBackups = (count: number) => {
	if (count < 1) return;
	toast.info(
		count === 1
			? 'Deleted 1 old backup to make space for the new backup.'
			: `Deleted ${count} old backups to make space for the new backup.`,
	);
};

type Args = {
	server: Server | undefined;
	serverId: string;
	isBusy: boolean;
	setIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
	updateServer: (id: string, update: ServerUpdate) => void;
	syncServerContents: () => Promise<void>;
	showError: (error: unknown, fallback: string) => string;
};

export const useServerBackupActions = ({
	server,
	serverId,
	isBusy,
	setIsBusy,
	updateServer,
	syncServerContents,
	showError,
}: Args) => {
	const handleDeleteBackup = React.useCallback(
		async (backupDirectory: string) => {
			if (!server) return;
			if (isBusy || server.status === 'online') return;

			setIsBusy(true);
			try {
				await invoke('delete_server_backup', {
					payload: {
						directory: server.directory,
						backupDirectory,
					},
				});
				await syncServerContents();
			} catch (err) {
				showError(err, 'Failed to delete backup.');
			} finally {
				setIsBusy(false);
			}
		},
		[isBusy, server, setIsBusy, showError, syncServerContents],
	);

	const handleCreateBackup = React.useCallback(async () => {
		if (!server) return;
		if (isBusy || server.status === 'online') return;
		setIsBusy(true);
		try {
			const result = await invoke<CreateServerBackupResult>('create_server_backup', {
				directory: server.directory,
			});
			notifyDeletedBackups(Math.max(0, Number(result.deletedBackupsCount) || 0));
			await syncServerContents();
		} catch (err) {
			const message = toErrorMessage(err, 'Failed to create backup.');
			if (isBackupStorageLimitError(message)) {
				toast.error(message, { duration: Infinity, id: 'backup-storage-limit' });
				return;
			}
			showError(err, 'Failed to create backup.');
		} finally {
			setIsBusy(false);
		}
	}, [isBusy, server, setIsBusy, showError, syncServerContents]);

	const handleSetStorageLimit = React.useCallback(
		async (storageLimitGb: number) => {
			if (!server) return;
			if (server.status === 'online') {
				toast.error('Take the server offline before changing storage limit.');
				return;
			}

			const nextLimit = Math.max(1, Math.round(Number(storageLimitGb) || server.storage_limit || 200));
			try {
				await invoke('update_server_settings', {
					payload: {
						directory: server.directory,
						ram: Math.max(1, Number(server.ram) || 3),
						storage_limit: nextLimit,
						auto_backup: server.auto_backup,
						auto_backup_interval: Math.max(1, Number(server.auto_backup_interval) || 120),
						auto_restart: server.auto_restart,
						custom_flags: server.custom_flags,
						java_installation: server.java_installation,
						provider: server.provider,
					},
				});

				updateServer(serverId, { storage_limit: nextLimit });
				toast.success(`Backup storage limit updated to ${nextLimit} GB.`);
			} catch (err) {
				showError(err, 'Failed to update backup storage limit.');
				throw err;
			}
		},
		[server, serverId, showError, updateServer],
	);

	const handleSetDeleteInterval = React.useCallback(
		async (intervalMinutes: number) => {
			if (!server) return;
			if (server.status === 'online') {
				toast.error('Take the server offline before changing cleanup interval.');
				return;
			}

			const nextInterval = Math.max(
				1,
				Math.round(Number(intervalMinutes) || server.auto_backup_interval || 120),
			);
			const autoBackupModes: AutoBackupMode[] = server.auto_backup;
			const nextAutoBackup: AutoBackupMode[] = autoBackupModes.includes('interval')
				? [...autoBackupModes]
				: [...autoBackupModes, 'interval'];

			await invoke('update_server_settings', {
				payload: {
					directory: server.directory,
					ram: Math.max(1, Number(server.ram) || 3),
					storage_limit: Math.max(1, Number(server.storage_limit) || 200),
					auto_backup: nextAutoBackup,
					auto_backup_interval: nextInterval,
					auto_restart: server.auto_restart,
					custom_flags: server.custom_flags,
					java_installation: server.java_installation,
					provider: server.provider,
				},
			});

			updateServer(serverId, {
				auto_backup_interval: nextInterval,
				auto_backup: nextAutoBackup,
			});
			toast.success(`Old backup cleanup interval updated to ${nextInterval} minutes.`);
		},
		[server, serverId, updateServer],
	);

	const handleClearAllBackups = React.useCallback(async () => {
		if (!server) return;
		if (isBusy || server.status === 'online') return;

		const backupsToDelete = [...server.backups];
		if (backupsToDelete.length === 0) {
			toast.success('No backups to clear.');
			return;
		}

		setIsBusy(true);
		try {
			await toast.promise(
				(async () => {
					for (const backup of backupsToDelete) {
						await invoke('delete_server_backup', {
							payload: {
								directory: server.directory,
								backupDirectory: backup.directory,
							},
						});
					}

					await syncServerContents();
					return backupsToDelete.length;
				})(),
				{
					loading: 'Clearing all backups...',
					success: (count) => `Cleared ${count} backups.`,
					error: (err) => (err instanceof Error ? err.message : 'Failed to clear all backups.'),
				},
			);
		} finally {
			setIsBusy(false);
		}
	}, [isBusy, server, setIsBusy, syncServerContents]);

	const handleRestoreBackup = React.useCallback(
		async (backupDirectory: string) => {
			if (!server) return;
			if (isBusy || server.status === 'online') return;

			setIsBusy(true);
			let loadingToastId: string | number | undefined;
			try {
				const backupName = getBackupNameFromPath(backupDirectory);
				loadingToastId = toast.loading('Creating backup of current state and restoring...');
				const result = await invoke<RestoreServerBackupResult>('restore_server_backup', {
					payload: {
						directory: server.directory,
						backupDirectory,
					},
				});
				notifyDeletedBackups(Math.max(0, Number(result.deletedBackupsCount) || 0));
				await syncServerContents();
				toast.success(`Backup created and ${backupName} has been restored`, { id: loadingToastId });
			} catch (err) {
				const message = toErrorMessage(err, 'Failed to restore backup.');
				if (isBackupStorageLimitError(message)) {
					if (loadingToastId !== undefined) {
						toast.dismiss(loadingToastId);
					}
					toast.error(message, { duration: Infinity, id: 'backup-storage-limit' });
					return;
				}
				if (loadingToastId !== undefined) {
					toast.error(message, { id: loadingToastId });
					return;
				}
				toast.error(message);
			} finally {
				setIsBusy(false);
			}
		},
		[isBusy, server, setIsBusy, syncServerContents],
	);

	return {
		handleDeleteBackup,
		handleCreateBackup,
		handleSetStorageLimit,
		handleSetDeleteInterval,
		handleClearAllBackups,
		handleRestoreBackup,
	};
};
