'use client';

import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AutoBackupMode, Server, useServers } from '@/data/servers';
import { FolderOpen, Plus } from 'lucide-react';

const defaultData = {
	directory: '',
	createDirectoryIfMissing: true,
	file: 'server.jar',
	ram: 3,
	autoRestart: false,
	autoBackup: [] as AutoBackupMode[],
	autoBackupInterval: 120,
	autoAgreeEula: true,
};

type InitServerPayload = {
	directory: string;
	createDirectoryIfMissing: boolean;
	file: string;
	ram: number;
	autoRestart: boolean;
	autoBackup: AutoBackupMode[];
	autoBackupInterval: number;
	autoAgreeEula: boolean;
};

type InitServerResult = {
	ok: boolean;
	message: string;
	file: string;
	directory: string;
};

const getDirectoryName = (directory: string) => {
	const segments = directory.split(/[\\/]/).filter(Boolean);
	return segments[segments.length - 1] || 'Server';
};

const buildServer = (form: InitServerPayload, result: InitServerResult): Server => ({
	name: getDirectoryName(result.directory),
	directory: result.directory,
	status: 'offline',
	backups: [],
	datapacks: [],
	worlds: [],
	plugins: [],
	stats: {
		players: 0,
		capacity: 20,
		tps: 0,
		uptime: null,
	},
	file: result.file,
	ram: Math.max(1, Number(form.ram) || 1),
	auto_backup: form.autoBackup,
	auto_backup_interval: Math.max(1, Number(form.autoBackupInterval) || 120),
	auto_restart: form.autoRestart,
	explicit_info_names: false,
	createdAt: new Date(),
});

const backupChoices: { value: AutoBackupMode; label: string }[] = [
	{ value: 'interval', label: 'Interval' },
	{ value: 'on_close', label: 'On close' },
	{ value: 'on_start', label: 'On start' },
];

export const CreateServer: React.FC = () => {
	const { addServer } = useServers();
	const [open, setOpen] = React.useState(false);
	const [form, setForm] = React.useState(defaultData);
	const [isSubmitting, setIsSubmitting] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const updateField = <K extends keyof typeof defaultData>(key: K, value: (typeof defaultData)[K]) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	};

	const toggleBackupMode = (mode: AutoBackupMode, enabled: boolean) => {
		setForm((prev) => ({
			...prev,
			autoBackup: enabled
				? Array.from(new Set([...prev.autoBackup, mode]))
				: prev.autoBackup.filter((item) => item !== mode),
		}));
	};

	const pickDirectory = async () => {
		const selected = await openDialog({
			directory: true,
			multiple: false,
			title: 'Choose server directory',
		});

		if (typeof selected === 'string') {
			updateField('directory', selected);
			setError(null);
		}
	};

	const resetForm = () => {
		setForm(defaultData);
		setError(null);
	};

	const onSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);

		const directory = form.directory.trim();
		if (!directory) {
			setError('Please choose a server directory.');
			return;
		}

		setIsSubmitting(true);
		try {
			const payload: InitServerPayload = {
				directory,
				createDirectoryIfMissing: form.createDirectoryIfMissing,
				file: form.file.trim() || 'server.jar',
				ram: Math.max(1, Number(form.ram) || 3),
				autoRestart: form.autoRestart,
				autoBackup: form.autoBackup,
				autoBackupInterval: Math.max(1, Number(form.autoBackupInterval) || 120),
				autoAgreeEula: form.autoAgreeEula,
			};

			const result = await invoke<InitServerResult>('initialize_server', { payload });
			if (!result.ok) {
				setError(result.message || 'Failed to initialize server.');
				return;
			}

			addServer(buildServer(payload, result));
			resetForm();
			setOpen(false);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to initialize server.';
			setError(message);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant='link' className='mt-6'>
					<Plus /> Create new server
				</Button>
			</DialogTrigger>
			<DialogContent className='sm:max-w-lg'>
				<DialogHeader>
					<DialogTitle>Create a new server</DialogTitle>
					<DialogDescription>Set up your server directory and runtime options.</DialogDescription>
				</DialogHeader>
				<form onSubmit={onSubmit} className='space-y-6'>
					<FieldGroup>
						<Field>
							<Label htmlFor='server-directory'>Server directory</Label>
							<div className='flex gap-2'>
								<Input
									id='server-directory'
									placeholder='C:\\Servers\\MyServer'
									value={form.directory}
									onChange={(event) => updateField('directory', event.target.value)}
									required
								/>
								<Button type='button' variant='outline' onClick={pickDirectory}>
									<FolderOpen /> Browse
								</Button>
							</div>
						</Field>
						<Field>
							<Label className='flex items-center gap-3'>
								<input
									type='checkbox'
									checked={form.createDirectoryIfMissing}
									onChange={(event) => updateField('createDirectoryIfMissing', event.target.checked)}
								/>
								Create directory if it doesn't exist
							</Label>
						</Field>
						<Field>
							<Label htmlFor='server-file'>Server jar filename</Label>
							<Input
								id='server-file'
								placeholder='server.jar'
								value={form.file}
								onChange={(event) => updateField('file', event.target.value)}
								required
							/>
						</Field>
						<Field>
							<Label htmlFor='server-ram'>RAM (GB)</Label>
							<Input
								id='server-ram'
								type='number'
								value={form.ram}
								onChange={(event) => updateField('ram', Number(event.target.value))}
								min={1}
								required
							/>
						</Field>
						<Field>
							<Label className='flex items-center gap-3'>
								<input
									type='checkbox'
									checked={form.autoRestart}
									onChange={(event) => updateField('autoRestart', event.target.checked)}
								/>
								Auto restart server when it closes
							</Label>
						</Field>
						<Field>
							<Label>Auto backup modes</Label>
							<div className='space-y-2'>
								{backupChoices.map((choice) => (
									<Label key={choice.value} className='flex items-center gap-3'>
										<input
											type='checkbox'
											checked={form.autoBackup.includes(choice.value)}
											onChange={(event) => toggleBackupMode(choice.value, event.target.checked)}
										/>
										{choice.label}
									</Label>
								))}
							</div>
							<p className='text-xs text-muted-foreground'>
								Warning: backup features can use a high amount of storage space.
							</p>
						</Field>
						{form.autoBackup.includes('interval') && (
							<Field>
								<Label htmlFor='server-backup-interval'>Backup interval (minutes)</Label>
								<Input
									id='server-backup-interval'
									type='number'
									value={form.autoBackupInterval}
									onChange={(event) => updateField('autoBackupInterval', Number(event.target.value))}
									min={1}
									required
								/>
							</Field>
						)}
						<Field>
							<Label className='flex items-center gap-3'>
								<input
									type='checkbox'
									checked={form.autoAgreeEula}
									onChange={(event) => updateField('autoAgreeEula', event.target.checked)}
								/>
								Auto agree to eula.txt
							</Label>
						</Field>
						{error && <p className='text-sm text-destructive'>{error}</p>}
						<p className='text-xs text-muted-foreground'>
							If the selected jar (or server.jar) exists in Downloads, it will be auto-moved.
						</p>
					</FieldGroup>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant='outline' type='button' onClick={resetForm} disabled={isSubmitting}>
								Cancel
							</Button>
						</DialogClose>
						<Button type='submit' disabled={isSubmitting}>
							{isSubmitting ? 'Creating...' : 'Create server'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};

export default CreateServer;
