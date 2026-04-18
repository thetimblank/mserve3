'use client';

import * as React from 'react';
import { FolderOpen, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type AutoBackupMode, type ServerSetupFormData } from '@/lib/mserve-sync';
import { backupChoices } from '@/pages/server/server-constants';
import { toggleBackupMode as toggleBackupModeValue } from '@/pages/server/server-utils';
import RamSliderField from '@/components/ram-slider-field';

type ServerSetupFormFieldsProps = {
	form: ServerSetupFormData;
	onFieldChange: <K extends keyof ServerSetupFormData>(key: K, value: ServerSetupFormData[K]) => void;
	onPickDirectory?: () => Promise<void> | void;
	onPickServerFile: () => Promise<void> | void;
	idPrefix: string;
	showDirectory?: boolean;
	showCreateDirectoryIfMissing?: boolean;
	showAutoAgreeEula?: boolean;
};

const asNumber = (value: string, fallback: number) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

export const ServerSetupFormFields: React.FC<ServerSetupFormFieldsProps> = ({
	form,
	onFieldChange,
	onPickDirectory,
	onPickServerFile,
	idPrefix,
	showDirectory = true,
	showCreateDirectoryIfMissing = true,
	showAutoAgreeEula = true,
}) => {
	const handleToggleBackupMode = (mode: AutoBackupMode, enabled: boolean) => {
		onFieldChange('auto_backup', toggleBackupModeValue(form.auto_backup, mode, enabled));
	};

	return (
		<>
			{showDirectory && (
				<div className='space-y-2'>
					<Field>
						<Label htmlFor={`${idPrefix}-directory`}>Server Location</Label>
						<div className='flex gap-2'>
							<Input
								id={`${idPrefix}-directory`}
								placeholder='C:\\servers\\MyServer'
								value={form.directory}
								onChange={(event) => onFieldChange('directory', event.target.value)}
								required
							/>
							<Button type='button' variant='outline' onClick={onPickDirectory}>
								<FolderOpen /> Browse
							</Button>
						</div>
					</Field>
					{showCreateDirectoryIfMissing && (
						<Field>
							<Label className='flex items-center gap-3'>
								<Checkbox
									checked={form.create_directory_if_missing}
									onCheckedChange={(checked) =>
										onFieldChange(
											'create_directory_if_missing',
											typeof checked === 'boolean' ? checked : false,
										)
									}
								/>
								Create directory if it doesn't exist
							</Label>
						</Field>
					)}
				</div>
			)}

			<Field>
				<Label htmlFor={`${idPrefix}-file`}>Server Jar File Location</Label>
				<div className='flex gap-2'>
					<Input
						id={`${idPrefix}-file`}
						placeholder='C:\\servers\\server-1.21.11.jar'
						value={form.file}
						onChange={(event) => onFieldChange('file', event.target.value)}
						required
					/>
					<Button type='button' variant='outline' onClick={onPickServerFile}>
						<FolderOpen /> Browse
					</Button>
				</div>
			</Field>

			<RamSliderField
				id={`${idPrefix}-ram`}
				value={form.ram}
				onChange={(value) => onFieldChange('ram', value)}
			/>

			<Field>
				<Label htmlFor={`${idPrefix}-java-installation`}>Java installation override (optional)</Label>
				<Input
					id={`${idPrefix}-java-installation`}
					placeholder='C:\\Program Files\\Java\\jdk-25\\bin\\java.exe'
					value={form.java_installation}
					onChange={(event) => onFieldChange('java_installation', event.target.value)}
				/>
			</Field>

			<Field>
				<Label>Auto backup modes</Label>
				<div className='space-y-2'>
					{backupChoices.map((choice) => (
						<Label key={choice.value} className='flex items-center gap-3'>
							<Checkbox
								checked={form.auto_backup.includes(choice.value)}
								onCheckedChange={(checked) =>
									handleToggleBackupMode(
										choice.value,
										typeof checked === 'boolean' ? checked : false,
									)
								}
							/>
							{choice.label}
						</Label>
					))}
				</div>
			</Field>
			{form.auto_backup.length > 0 && (
				<Field>
					<Label htmlFor={`${idPrefix}-storage-limit`}>Backup storage limit (GB)</Label>
					<Input
						id={`${idPrefix}-storage-limit`}
						type='number'
						value={form.storage_limit}
						onChange={(event) =>
							onFieldChange('storage_limit', asNumber(event.target.value, form.storage_limit))
						}
						min={1}
						required
					/>
					<p className='text-sm text-muted-foreground flex gap-2 items-center'>
						<TriangleAlert className='size-4 shrink-0' />
						Backups can grow quickly. Set a limit to avoid filling the disk.
					</p>
				</Field>
			)}
			{form.auto_backup.includes('interval') && (
				<Field>
					<Label htmlFor={`${idPrefix}-backup-interval`}>Backup interval (minutes)</Label>
					<Input
						id={`${idPrefix}-backup-interval`}
						type='number'
						value={form.auto_backup_interval}
						onChange={(event) =>
							onFieldChange(
								'auto_backup_interval',
								asNumber(event.target.value, form.auto_backup_interval),
							)
						}
						min={1}
						required
					/>
				</Field>
			)}
			<Field>
				<Label className='flex items-center gap-3'>
					<Checkbox
						checked={form.auto_restart}
						onCheckedChange={(checked) =>
							onFieldChange('auto_restart', typeof checked === 'boolean' ? checked : false)
						}
					/>
					Auto restart server when it closes
				</Label>
			</Field>
			{showAutoAgreeEula && (
				<Field>
					<Label className='flex items-center gap-3'>
						<Checkbox
							checked={form.auto_agree_eula}
							onCheckedChange={(checked) =>
								onFieldChange('auto_agree_eula', typeof checked === 'boolean' ? checked : false)
							}
						/>
						Auto agree to eula.txt
					</Label>
				</Field>
			)}
		</>
	);
};
