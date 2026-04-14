'use client';

import * as React from 'react';
import { FolderOpen, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type AutoBackupMode, type ServerSetupFormData } from '@/lib/mserve-sync';
import RamSliderField from '@/components/ram-slider-field';

const backupChoices: { value: AutoBackupMode; label: string }[] = [
	{ value: 'interval', label: 'Interval' },
	{ value: 'on_close', label: 'On close' },
	{ value: 'on_start', label: 'On start' },
];

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
	const toggleBackupMode = (mode: AutoBackupMode, enabled: boolean) => {
		onFieldChange(
			'autoBackup',
			enabled
				? Array.from(new Set([...form.autoBackup, mode]))
				: form.autoBackup.filter((item) => item !== mode),
		);
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
									checked={form.createDirectoryIfMissing}
									onCheckedChange={(checked) =>
										onFieldChange(
											'createDirectoryIfMissing',
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
				<Label>Auto backup modes</Label>
				<div className='space-y-2'>
					{backupChoices.map((choice) => (
						<Label key={choice.value} className='flex items-center gap-3'>
							<Checkbox
								checked={form.autoBackup.includes(choice.value)}
								onCheckedChange={(checked) =>
									toggleBackupMode(choice.value, typeof checked === 'boolean' ? checked : false)
								}
							/>
							{choice.label}
						</Label>
					))}
				</div>
			</Field>
			{form.autoBackup.length > 0 && (
				<Field>
					<Label htmlFor={`${idPrefix}-storage-limit`}>Backup storage limit (GB)</Label>
					<Input
						id={`${idPrefix}-storage-limit`}
						type='number'
						value={form.storageLimit}
						onChange={(event) =>
							onFieldChange('storageLimit', asNumber(event.target.value, form.storageLimit))
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
			{form.autoBackup.includes('interval') && (
				<Field>
					<Label htmlFor={`${idPrefix}-backup-interval`}>Backup interval (minutes)</Label>
					<Input
						id={`${idPrefix}-backup-interval`}
						type='number'
						value={form.autoBackupInterval}
						onChange={(event) =>
							onFieldChange(
								'autoBackupInterval',
								asNumber(event.target.value, form.autoBackupInterval),
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
						checked={form.autoRestart}
						onCheckedChange={(checked) =>
							onFieldChange('autoRestart', typeof checked === 'boolean' ? checked : false)
						}
					/>
					Auto restart server when it closes
				</Label>
			</Field>
			{showAutoAgreeEula && (
				<Field>
					<Label className='flex items-center gap-3'>
						<Checkbox
							checked={form.autoAgreeEula}
							onCheckedChange={(checked) =>
								onFieldChange('autoAgreeEula', typeof checked === 'boolean' ? checked : false)
							}
						/>
						Auto agree to eula.txt
					</Label>
				</Field>
			)}
		</>
	);
};
