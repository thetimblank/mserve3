import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { isStoppedStatus, type Server, type ServerUpdate } from '@/data/servers';
import type { AutoBackupMode, BackupPolicy, BackupScopeItem } from '@/lib/mserve-schema';
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
			? 'Removed 1 old backup per your retention settings.'
			: `Removed ${count} old backups per your retention settings.`,
	);
};

/** Everything the backup settings sheet can change in one save. */
export type BackupSettingsUpdate = {
	auto_backup: AutoBackupMode[];
	auto_backup_interval: number;
	storage_limit: number;
	backup_policy: BackupPolicy;
	backup_max_count: number;
	backup_max_age_days: number;
	backup_scope: BackupScopeItem[];
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
			if (isBusy || !isStoppedStatus(server.status)) return;

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

	const handleCreateBackup = React.useCallback(
		async (name?: string) => {
			if (!server) return;
			if (isBusy || !isStoppedStatus(server.status)) return;
			setIsBusy(true);
			try {
				const result = await invoke<CreateServerBackupResult>('create_server_backup', {
					directory: server.directory,
					name: name?.trim() || null,
					reason: 'manual',
				});
				notifyDeletedBackups(Math.max(0, Number(result.deletedBackupsCount) || 0));
				await syncServerContents();
				toast.success('Backup created.');
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
		},
		[isBusy, server, setIsBusy, showError, syncServerContents],
	);

	/** Locks/unlocks a backup so retention and storage limits skip it. */
	const handleSetBackupLocked = React.useCallback(
		async (backupDirectory: string, locked: boolean) => {
			if (!server) return;

			try {
				await invoke('set_server_backup_locked', {
					payload: {
						directory: server.directory,
						backupDirectory,
						locked,
					},
				});
				updateServer(serverId, {
					backups: server.backups.map((backup) =>
						backup.directory === backupDirectory ? { ...backup, locked } : backup,
					),
				});
				toast.success(locked ? 'Backup locked — retention will never remove it.' : 'Backup unlocked.');
			} catch (err) {
				showError(err, 'Failed to update the backup lock.');
			}
		},
		[server, serverId, showError, updateServer],
	);

	/**
	 * Persists the whole backup settings sheet (triggers + retention + scope),
	 * then re-applies retention so the user immediately sees its effect.
	 */
	const handleSaveBackupSettings = React.useCallback(
		async (settings: BackupSettingsUpdate) => {
			if (!server) return;

			const storageLimit = Math.max(1, Math.round(Number(settings.storage_limit) || 200));
			const interval = Math.max(1, Math.round(Number(settings.auto_backup_interval) || 120));
			const maxCount = Math.max(0, Math.round(Number(settings.backup_max_count) || 0));
			const maxAgeDays = Math.max(0, Math.round(Number(settings.backup_max_age_days) || 0));

			try {
				await invoke('update_server_backup_settings', {
					directory: server.directory,
					storageLimit,
					autoBackup: settings.auto_backup,
					autoBackupInterval: interval,
					autoRestart: server.auto_restart,
					backupPolicy: settings.backup_policy,
					backupMaxCount: maxCount,
					backupMaxAgeDays: maxAgeDays,
					backupScope: settings.backup_scope,
				});

				updateServer(serverId, {
					storage_limit: storageLimit,
					auto_backup: settings.auto_backup,
					auto_backup_interval: interval,
					backup_policy: settings.backup_policy,
					backup_max_count: maxCount,
					backup_max_age_days: maxAgeDays,
					backup_scope: settings.backup_scope,
				});

				// Retention may now allow fewer/older backups; apply right away so
				// the list reflects the new rules instead of waiting for the next
				// backup to be created.
				try {
					const deleted = await invoke<number>('apply_server_backup_retention', {
						directory: server.directory,
					});
					notifyDeletedBackups(Math.max(0, Number(deleted) || 0));
				} catch {
					// A retention failure (e.g. storage limit smaller than locked
					// backups) shouldn't undo the saved settings.
				}

				await syncServerContents();
				toast.success('Backup settings saved.');
			} catch (err) {
				showError(err, 'Failed to save backup settings.');
				throw err;
			}
		},
		[server, serverId, showError, syncServerContents, updateServer],
	);

	const handleClearAllBackups = React.useCallback(async () => {
		if (!server) return;
		if (isBusy || !isStoppedStatus(server.status)) return;

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
			if (isBusy || !isStoppedStatus(server.status)) return;

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
		handleSetBackupLocked,
		handleSaveBackupSettings,
		handleClearAllBackups,
		handleRestoreBackup,
	};
};
