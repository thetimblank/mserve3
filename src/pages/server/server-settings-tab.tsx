'use client';

import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import EditServerPropertiesForm from '@/components/edit-server-properties-form';
import { Eye, EyeOff, Link2Off, RefreshCcw, Trash } from 'lucide-react';
import { repairServerMserveJson, syncServerMserveJson } from '@/lib/mserve-sync';
import { requestMserveRepair } from '@/lib/mserve-repair-controller';
import { Server, useServers } from '@/data/servers';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';

interface Props {
	hideBackgroundTelemetry: boolean;
	setHideBackgroundTelemetry: React.Dispatch<React.SetStateAction<boolean>>;
	clearTerminalSession: () => void;
	server: Server;
	isBusy: boolean;
	setIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
	syncServerContents: () => Promise<void>;
}

export default function ServerSettingsTab({
	clearTerminalSession,
	server,
	isBusy,
	setIsBusy,
	syncServerContents,
	hideBackgroundTelemetry,
	setHideBackgroundTelemetry,
}: Props) {
	const navigate = useNavigate();
	const { removeServer, updateServer } = useServers();
	const serverId = server.id;

	const handleManualSync = async () => {
		if (isBusy || server.status !== 'offline') return;

		setIsBusy(true);
		try {
			let synced = await syncServerMserveJson(server.directory);
			let resolvedStorageLimit = server.storage_limit ?? 200;

			if (synced.status === 'needs_setup') {
				const repairPayload = await requestMserveRepair({
					directory: server.directory,
					file: server.file,
					ram: server.ram ?? 3,
					storageLimit: resolvedStorageLimit,
					autoBackup: server.auto_backup ?? [],
					autoBackupInterval: server.auto_backup_interval ?? 120,
					autoRestart: server.auto_restart ?? false,
					createDirectoryIfMissing: true,
					autoAgreeEula: true,
					explicitInfoNames: server.explicit_info_names ?? false,
					customFlags: server.custom_flags ?? [],
				});

				if (!repairPayload) {
					toast.error('Sync cancelled. mserve.json rebuild was not completed.');
					return;
				}

				resolvedStorageLimit = repairPayload.storageLimit;
				synced = await repairServerMserveJson(repairPayload);
			}

			if (!synced.config) {
				throw new Error('Valid mserve.json data could not be resolved.');
			}

			updateServer(serverId, {
				id: synced.config.id,
				file: synced.config.file,
				ram: synced.config.ram,
				storage_limit: resolvedStorageLimit,
				auto_backup: synced.config.auto_backup,
				auto_backup_interval: synced.config.auto_backup_interval,
				auto_restart: synced.config.auto_restart,
				explicit_info_names: synced.config.explicit_info_names,
				custom_flags: synced.config.custom_flags,
				provider: synced.config.provider,
				version: synced.config.version,
				createdAt: new Date(synced.config.createdAt),
			});

			toast.success(synced.message);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to sync mserve.json.';
			toast.error(message);
		} finally {
			setIsBusy(false);
		}
	};

	const handleDelete = async () => {
		if (isBusy) return;

		setIsBusy(true);
		try {
			await invoke('delete_server', { directory: server.directory });
			clearTerminalSession();
			removeServer(serverId);
			navigate('/');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to delete server.';
			toast.error(message);
		} finally {
			setIsBusy(false);
		}
	};

	const handleRemoveServer = async () => {
		if (isBusy || server.status === 'online') return;

		setIsBusy(true);
		try {
			clearTerminalSession();
			removeServer(serverId);
			toast.success(`Removed ${server.name} from mserve.`);
			navigate('/');
		} finally {
			setIsBusy(false);
		}
	};

	return (
		<div className='flex flex-col gap-6'>
			<div className='rounded-lg'>
				<p className='text-2xl font-bold mb-2'>Settings</p>
				<div className='flex flex-wrap gap-2'>
					<Button
						variant='secondary'
						onClick={() => setHideBackgroundTelemetry((prev) => !prev)}
						disabled={isBusy}>
						{hideBackgroundTelemetry ? <Eye /> : <EyeOff />}
						{hideBackgroundTelemetry ? 'Show Status Check logs' : 'Hide Status Check logs'}
					</Button>
					<Button
						variant='secondary'
						onClick={handleManualSync}
						disabled={isBusy || server.status !== 'offline'}>
						<RefreshCcw />
						<p>Sync mserve.json</p>
					</Button>
				</div>
				<p className='text-sm text-muted-foreground mt-1'>
					Sync and save operations require the server to be offline.
				</p>
			</div>

			<div className='space-y-4 bg-secondary p-6 rounded-lg'>
				<p className='text-2xl font-bold'>Edit Properties</p>
				<EditServerPropertiesForm server={server} disabled={isBusy} onSaved={syncServerContents} />
			</div>

			<div className='bg-destructive/10 rounded-lg p-6 space-y-4'>
				<p className='text-2xl font-bold'>Danger Zone</p>
				<div className='flex flex-wrap gap-2'>
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button disabled={isBusy || server.status === 'online'} variant='destructive-secondary'>
								<Link2Off />
								<p>Remove Server</p>
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Are you sure?</AlertDialogTitle>
								<AlertDialogDescription>
									This will remove the server from the MSERVE app. It will lose it&apos;s data
									associated with the app. However, it will NOT delete any files and it will NOT
									remove mserve.json. You can always import the server again.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									variant='destructive'
									onClick={handleRemoveServer}
									className='capitalize'>
									Remove Server
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button disabled={isBusy || server.status === 'online'} variant='destructive'>
								<Trash />
								<p>Delete Server</p>
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Are you sure?</AlertDialogTitle>
								<AlertDialogDescription>
									This will move the server to the recycling bin.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									variant='destructive'
									className='capitalize'
									onClick={handleDelete}>
									Delete Server
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</div>
		</div>
	);
}
