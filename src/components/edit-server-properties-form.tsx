import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { type Server, useServers } from '@/data/servers';
import RamSliderField from '@/components/ram-slider-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { backupChoices } from '@/pages/server/server-constants';
import {
	buildUpdateServerSettingsPayload,
	resolveNewDirectory,
	toggleBackupMode,
} from '@/pages/server/server-utils';
import type { ServerSettingsForm, UpdateServerSettingsResult } from '@/pages/server/server-types';

type EditServerPropertiesFormProps = {
	server: Server;
	disabled?: boolean;
	onSaved?: () => Promise<void> | void;
	onCancel?: () => void;
	showCancel?: boolean;
	saveLabel?: string;
	className?: string;
};

const EditServerPropertiesForm: React.FC<EditServerPropertiesFormProps> = ({
	server,
	disabled,
	onSaved,
	onCancel,
	showCancel,
	saveLabel,
	className,
}) => {
	const { updateServer } = useServers();
	const [isSaving, setIsSaving] = React.useState(false);
	const [settingsError, setSettingsError] = React.useState<string | null>(null);
	const [settingsForm, setSettingsForm] = React.useState<ServerSettingsForm>({
		ram: 3,
		autoBackup: [],
		autoBackupInterval: 120,
		autoRestart: false,
		jarSwapPath: '',
		newDirectory: '',
	});

	const serverId = server.id;

	React.useEffect(() => {
		setSettingsForm({
			ram: Math.max(1, server.ram ?? 3),
			autoBackup: server.auto_backup ?? [],
			autoBackupInterval: Math.max(1, server.auto_backup_interval ?? 120),
			autoRestart: server.auto_restart ?? false,
			jarSwapPath: '',
			newDirectory: server.directory,
		});
		setSettingsError(null);
	}, [server.auto_backup, server.auto_backup_interval, server.auto_restart, server.directory, server.ram]);

	const updateSettingsField = React.useCallback(
		<K extends keyof ServerSettingsForm>(key: K, value: ServerSettingsForm[K]) => {
			setSettingsForm((prev) => ({ ...prev, [key]: value }));
		},
		[],
	);

	const toggleSettingsBackupMode = React.useCallback(
		(mode: (typeof backupChoices)[number]['value'], enabled: boolean) => {
			setSettingsForm((prev) => ({
				...prev,
				autoBackup: toggleBackupMode(prev.autoBackup, mode, enabled),
			}));
		},
		[],
	);

	const pickSwapJarFile = React.useCallback(async () => {
		try {
			const selected = await openDialog({
				directory: false,
				multiple: false,
				filters: [{ extensions: ['jar'], name: 'Jar Files' }],
				title: 'Choose jar file to swap with server jar',
			});

			if (typeof selected === 'string') {
				updateSettingsField('jarSwapPath', selected);
				setSettingsError(null);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Could not open file picker.';
			setSettingsError(message);
		}
	}, [updateSettingsField]);

	const pickNewDirectory = React.useCallback(async () => {
		try {
			const selected = await openDialog({
				directory: true,
				multiple: false,
				title: 'Choose new server directory location',
			});

			if (typeof selected === 'string') {
				updateSettingsField('newDirectory', selected);
				setSettingsError(null);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Could not open directory picker.';
			setSettingsError(message);
		}
	}, [updateSettingsField]);

	const handleSaveSettings = React.useCallback(async () => {
		if (isSaving || server.status !== 'offline' || disabled) return;

		const payload = buildUpdateServerSettingsPayload(server.directory, settingsForm);
		payload.newDirectory = resolveNewDirectory(payload, server.directory);

		setSettingsError(null);
		setIsSaving(true);
		try {
			const savePromise = invoke<UpdateServerSettingsResult>('update_server_settings', { payload });
			await toast.promise(savePromise, {
				loading: 'Saving server settings...',
				success: 'Server settings updated',
				error: (err) => (err instanceof Error ? err.message : 'Failed to update server settings.'),
			});
			const result = await savePromise;

			updateServer(serverId, {
				directory: result.directory,
				file: result.file,
				ram: payload.ram,
				auto_backup: payload.autoBackup,
				auto_backup_interval: payload.autoBackupInterval,
				auto_restart: payload.autoRestart,
			});

			setSettingsForm((prev) => ({
				...prev,
				jarSwapPath: '',
				newDirectory: result.directory,
			}));
			await onSaved?.();
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to update server settings.';
			setSettingsError(message);
		} finally {
			setIsSaving(false);
		}
	}, [disabled, isSaving, onSaved, server.directory, server.status, serverId, settingsForm, updateServer]);

	return (
		<div className={clsx('space-y-4', className)}>
			<RamSliderField
				id='edit-server-ram'
				value={settingsForm.ram}
				onChange={(value) => updateSettingsField('ram', value)}
			/>

			<div className='space-y-2'>
				<Label htmlFor='edit-jar-swap'>Swap server jar with selected jar file</Label>
				<div className='flex gap-2'>
					<Input
						id='edit-jar-swap'
						placeholder='C:\path\to\another-server.jar'
						value={settingsForm.jarSwapPath}
						onChange={(event) => updateSettingsField('jarSwapPath', event.target.value)}
						disabled={disabled || isSaving || server.status !== 'offline'}
					/>
					<Button
						type='button'
						variant='outline'
						onClick={pickSwapJarFile}
						disabled={disabled || isSaving || server.status !== 'offline'}>
						<FolderOpen /> Browse
					</Button>
				</div>
				<p className='text-sm text-muted-foreground'>
					Selected jar and current server jar will be swapped between their locations.
				</p>
			</div>

			<div className='space-y-2'>
				<Label>Auto backup modes</Label>
				<div className='space-y-2'>
					{backupChoices.map((choice) => (
						<Label key={choice.value} className='flex items-center gap-3'>
							<Checkbox
								checked={settingsForm.autoBackup.includes(choice.value)}
								onCheckedChange={(checked) =>
									toggleSettingsBackupMode(
										choice.value,
										typeof checked === 'boolean' ? checked : false,
									)
								}
								disabled={disabled || isSaving || server.status !== 'offline'}
							/>
							{choice.label}
						</Label>
					))}
				</div>
			</div>

			{settingsForm.autoBackup.includes('interval') && (
				<div className='space-y-2'>
					<Label htmlFor='edit-backup-interval'>Backup interval (minutes)</Label>
					<Input
						id='edit-backup-interval'
						type='number'
						min={1}
						value={settingsForm.autoBackupInterval}
						onChange={(event) => updateSettingsField('autoBackupInterval', Number(event.target.value))}
						disabled={disabled || isSaving || server.status !== 'offline'}
					/>
				</div>
			)}

			<Label className='flex items-center gap-3'>
				<Checkbox
					checked={settingsForm.autoRestart}
					onCheckedChange={(checked) =>
						updateSettingsField('autoRestart', typeof checked === 'boolean' ? checked : false)
					}
					disabled={disabled || isSaving || server.status !== 'offline'}
				/>
				Auto restart server when it closes
			</Label>

			<div className='space-y-2'>
				<Label htmlFor='edit-new-location'>Move server location</Label>
				<div className='flex gap-2'>
					<Input
						id='edit-new-location'
						placeholder='C:\servers\MyServer'
						value={settingsForm.newDirectory}
						onChange={(event) => updateSettingsField('newDirectory', event.target.value)}
						disabled={disabled || isSaving || server.status !== 'offline'}
					/>
					<Button
						type='button'
						variant='outline'
						onClick={pickNewDirectory}
						disabled={disabled || isSaving || server.status !== 'offline'}>
						<FolderOpen /> Browse
					</Button>
				</div>
			</div>

			{server.status !== 'offline' && (
				<p className='text-sm text-muted-foreground'>
					Take the server offline before saving these settings.
				</p>
			)}
			{settingsError && <p className='text-sm text-destructive'>{settingsError}</p>}

			<div className='flex justify-end gap-2'>
				{showCancel && (
					<Button variant='outline' type='button' onClick={onCancel} disabled={isSaving}>
						Cancel
					</Button>
				)}
				<Button
					type='button'
					onClick={handleSaveSettings}
					disabled={disabled || isSaving || server.status !== 'offline'}>
					{isSaving ? 'Saving...' : (saveLabel ?? 'Save properties')}
				</Button>
			</div>
		</div>
	);
};

export default React.memo(EditServerPropertiesForm);
