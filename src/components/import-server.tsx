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
	file: '',
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

export const ImportServer: React.FC<React.HTMLAttributes<HTMLButtonElement>> = ({ ...props }) => {
	const { addServer } = useServers();
	const [open, setOpen] = React.useState(false);
	const [form, setForm] = React.useState(defaultData);
	const [isSubmitting, setIsSubmitting] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const updateField = <K extends keyof typeof defaultData>(key: K, value: (typeof defaultData)[K]) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	};

	const pickDirectory = async () => {
		try {
			const selected = await openDialog({
				directory: true,
				multiple: false,
				title: 'Choose server directory',
			});

			if (typeof selected === 'string') {
				updateField('directory', selected);
				setError(null);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Could not open directory picker.';
			setError(message);
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
			// check if its a valid location and that if create dir is not checked and a invalid folder is picked it will error
			setError('Please choose a server directory.');
			return;
		}

		const file = form.file.trim();
		if (!file) {
			// TODO: check if its a valid location to a jar file
			setError('Please choose a valid server jar file.');
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
				<Button variant='link' {...props}>
					<Plus /> Import server
				</Button>
			</DialogTrigger>
			<DialogContent className='min-w-2xl'>
				<DialogHeader>
					<DialogTitle>Import an existing server</DialogTitle>
					<DialogDescription>
						The server will automatically be made compatible with mserve.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={onSubmit} className='space-y-6'>
					<FieldGroup>
						<Field>
							<Label htmlFor='server-directory'>Server Location</Label>
							<div className='flex gap-2'>
								<Input
									id='server-directory'
									placeholder='C:\servers\MyServer'
									value={form.directory}
									onChange={(event) => updateField('directory', event.target.value)}
									required
								/>
								<Button type='button' variant='outline' onClick={pickDirectory}>
									<FolderOpen /> Browse
								</Button>
							</div>
						</Field>
						{error && <p className='text-sm text-destructive'>{error}</p>}
					</FieldGroup>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant='outline' type='button' onClick={resetForm} disabled={isSubmitting}>
								Cancel
							</Button>
						</DialogClose>
						<Button type='submit' disabled={isSubmitting}>
							{isSubmitting ? 'Importing...' : 'Import Server'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};

export default ImportServer;
