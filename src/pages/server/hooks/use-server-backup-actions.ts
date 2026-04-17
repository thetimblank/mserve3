import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { AutoBackupMode, Server, ServerUpdate } from '@/data/servers';
import { getBackupNameFromPath } from '../server-utils';

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
			await invoke('create_server_backup', { directory: server.directory });
			await syncServerContents();
		} catch (err) {
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
			await invoke('update_server_settings', {
				payload: {
					directory: server.directory,
					ram: Math.max(1, Number(server.ram) || 3),
					storageLimit: nextLimit,
					autoBackup: server.auto_backup ?? [],
					autoBackupInterval: Math.max(1, Number(server.auto_backup_interval) || 120),
					autoRestart: server.auto_restart ?? false,
					customFlags: server.custom_flags ?? [],
					javaInstallation: server.java_installation,
				},
			});

			updateServer(serverId, { storage_limit: nextLimit });
			toast.success(`Backup storage limit updated to ${nextLimit} GB.`);
		},
		[server, serverId, updateServer],
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
			const autoBackupModes: AutoBackupMode[] = server.auto_backup ?? [];
			const nextAutoBackup: AutoBackupMode[] = autoBackupModes.includes('interval')
				? [...autoBackupModes]
				: [...autoBackupModes, 'interval'];

			await invoke('update_server_settings', {
				payload: {
					directory: server.directory,
					ram: Math.max(1, Number(server.ram) || 3),
					storageLimit: Math.max(1, Number(server.storage_limit) || 200),
					autoBackup: nextAutoBackup,
					autoBackupInterval: nextInterval,
					autoRestart: server.auto_restart ?? false,
					customFlags: server.custom_flags ?? [],
					javaInstallation: server.java_installation,
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
			try {
				const backupName = getBackupNameFromPath(backupDirectory);
				await toast.promise(
					(async () => {
						await invoke('restore_server_backup', {
							payload: {
								directory: server.directory,
								backupDirectory,
							},
						});
						await syncServerContents();
						return { backupName };
					})(),
					{
						loading: 'Creating backup of current state and restoring...',
						success: (data) => `Backup created and ${data.backupName} has been restored`,
						error: (err) => (err instanceof Error ? err.message : 'Failed to restore backup.'),
					},
				);
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
