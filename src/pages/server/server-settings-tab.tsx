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
import { Link2Off, Lock, RefreshCcw, Trash } from 'lucide-react';
import { repairServerMserveJson, syncServerMserveJson } from '@/lib/mserve-sync';
import { requestMserveRepair } from '@/lib/mserve-repair-controller';
import type { JavaRuntimeInfo } from '@/lib/java-runtime-service';
import { Server, useServers } from '@/data/servers';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { Container } from '@/components/ui/container';
import clsx from 'clsx';

interface Props {
	clearTerminalSession: () => void;
	server: Server;
	javaRuntimes: JavaRuntimeInfo[];
	isBusy: boolean;
	setIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
	syncServerContents: () => Promise<void>;
}

export default function ServerSettingsTab({
	clearTerminalSession,
	server,
	javaRuntimes,
	isBusy,
	setIsBusy,
	syncServerContents,
}: Props) {
	const navigate = useNavigate();
	const { removeServer, updateServer } = useServers();
	const serverId = server.id;
	const isFormLocked = isBusy || server.status !== 'offline';

	const handleManualSync = async () => {
		if (isBusy || server.status !== 'offline') return;

		setIsBusy(true);
		try {
			let synced = await syncServerMserveJson(server.directory);

			if (synced.status === 'needs_setup') {
				if (!synced.config) {
					throw new Error('Could not load fallback mserve configuration for repair.');
				}

				const repairPayload = await requestMserveRepair({
					directory: server.directory,
					file: server.file,
					ram: server.ram,
					storage_limit: server.storage_limit,
					auto_backup: server.auto_backup,
					auto_backup_interval: server.auto_backup_interval,
					auto_restart: server.auto_restart,
					create_directory_if_missing: true,
					auto_agree_eula: true,
					java_installation: server.java_installation ?? '',
					custom_flags: server.custom_flags,
					provider: server.provider,
					telemetry_host: server.telemetry_host,
					telemetry_port: server.telemetry_port,
				});

				if (!repairPayload) {
					toast.error('Sync cancelled. mserve.json rebuild was not completed.');
					return;
				}

				synced = await repairServerMserveJson(repairPayload);
			}

			if (!synced.config) {
				throw new Error('Valid mserve.json data could not be resolved.');
			}

			updateServer(serverId, {
				id: synced.config.id,
				file: synced.config.file,
				ram: synced.config.ram,
				storage_limit: synced.config.storage_limit,
				auto_backup: synced.config.auto_backup,
				auto_backup_interval: synced.config.auto_backup_interval,
				auto_restart: synced.config.auto_restart,
				java_installation: synced.config.java_installation,
				custom_flags: synced.config.custom_flags,
				provider: synced.config.provider,
				telemetry_host: synced.config.telemetry_host,
				telemetry_port: synced.config.telemetry_port,
				created_at: synced.config.created_at,
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
		<div className='relative'>
			{server.status !== 'offline' && (
				<div className='absolute text-center flex items-center justify-center h-1/2 w-full flex-col gap-6'>
					<Lock className='size-20' />
					<p className='text-3xl font-bold'>Server must be offline to modify settings.</p>
				</div>
			)}
			<div
				aria-disabled={isFormLocked}
				className={clsx(
					'flex flex-col gap-6 transition-opacity',
					isFormLocked && 'opacity-50 pointer-events-none',
				)}>
				<div className='space-y-2 max-w-lg'>
					<p className='text-xl'>Sync Mserve.json</p>
					<Button
						variant='secondary'
						className='max-w-lg'
						onClick={handleManualSync}
						disabled={isBusy || server.status !== 'offline'}>
						<RefreshCcw />
						<p>Sync mserve.json</p>
					</Button>
				</div>

				<div className='space-y-4'>
					<EditServerPropertiesForm
						server={server}
						javaRuntimes={javaRuntimes}
						disabled={isBusy}
						onSaved={syncServerContents}
					/>
				</div>

				<Container variant='destructive' className='space-y-4'>
					<p className='text-2xl font-bold'>Danger Zone</p>
					<div className='flex flex-wrap gap-2'>
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button
									disabled={isBusy || server.status === 'online'}
									variant='destructive-secondary'>
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
				</Container>
			</div>
		</div>
	);
}
