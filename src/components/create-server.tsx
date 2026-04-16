'use client';

import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ServerSetupFormFields } from '@/components/server-setup-form-fields';
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
import { FieldGroup } from '@/components/ui/field';
import { Server, useServers } from '@/data/servers';
import {
	type AutoBackupMode,
	type ServerSetupFormData,
	createDefaultServerSetupForm,
} from '@/lib/mserve-sync';

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
	id: string;
	file: string;
	directory: string;
};

type PathValidationResult = {
	exists: boolean;
	isDirectory: boolean;
	isFile: boolean;
};

const getDirectoryName = (directory: string) => {
	const segments = directory.split(/[\\/]/).filter(Boolean);
	return segments[segments.length - 1] || 'Server';
};

const buildServer = (form: ServerSetupFormData, result: InitServerResult): Server => ({
	id: result.id,
	name: getDirectoryName(result.directory),
	directory: result.directory,
	status: 'offline',
	backups: [],
	datapacks: [],
	worlds: [],
	plugins: [],
	storage_limit: Math.max(1, Number(form.storageLimit) || 200),
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

export const CreateServer: React.FC<React.HTMLAttributes<HTMLButtonElement>> = ({ ...props }) => {
	const { addServer } = useServers();
	const [open, setOpen] = React.useState(false);
	const [form, setForm] = React.useState<ServerSetupFormData>(() => createDefaultServerSetupForm());
	const [isSubmitting, setIsSubmitting] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const updateField = <K extends keyof ServerSetupFormData>(key: K, value: ServerSetupFormData[K]) => {
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

	const pickServerFile = async () => {
		try {
			const selected = await openDialog({
				directory: false,
				multiple: false,
				filters: [
					{
						extensions: ['jar'],
						name: 'Jar Files',
					},
				],
				title: 'Choose server jar file',
			});

			if (typeof selected === 'string') {
				updateField('file', selected);
				setError(null);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Could not open file picker.';
			setError(message);
		}
	};

	const resetForm = () => {
		setForm(createDefaultServerSetupForm());
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

		const directoryValidation = await invoke<PathValidationResult>('validate_path', {
			path: directory,
		});
		if (directoryValidation.exists && !directoryValidation.isDirectory) {
			setError('Server location must be a directory.');
			return;
		}

		if (!form.createDirectoryIfMissing && !directoryValidation.exists) {
			setError(
				"Directory does not exist. Enable 'Create directory if it doesn't exist' or choose another path.",
			);
			return;
		}

		const file = form.file.trim();
		if (!file) {
			setError('Please choose a server jar file.');
			return;
		}

		if (!file.toLowerCase().endsWith('.jar')) {
			setError('Server file must be a .jar file.');
			return;
		}

		const fileValidation = await invoke<PathValidationResult>('validate_path', { path: file });
		if (!fileValidation.exists || !fileValidation.isFile) {
			setError('Please choose a valid server jar file.');
			return;
		}

		setIsSubmitting(true);
		try {
			const payload: InitServerPayload = {
				directory,
				createDirectoryIfMissing: form.createDirectoryIfMissing,
				file: file || 'server.jar',
				ram: Math.max(1, Number(form.ram) || 3),
				autoRestart: form.autoRestart,
				autoBackup: form.autoBackup,
				autoBackupInterval: Math.max(1, Number(form.autoBackupInterval) || 120),
				autoAgreeEula: form.autoAgreeEula,
			};

			const initializePromise = (async () => {
				const res = await invoke<InitServerResult>('initialize_server', { payload });
				if (!res.ok) {
					throw new Error(res.message || 'Failed to initialize server.');
				}
				return res;
			})();

			await toast.promise(initializePromise, {
				loading: 'Creating server...',
				success: () => `Server "${getDirectoryName(directory)}" has been created`,
				error: (err) => (err instanceof Error ? err.message : 'Failed to create server.'),
			});

			const result = await initializePromise;

			addServer(buildServer(form, result));
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
					<Plus /> Create new server
				</Button>
			</DialogTrigger>
			<DialogContent className='min-w-2xl'>
				<DialogHeader>
					<DialogTitle>Create a new server</DialogTitle>
					<DialogDescription>Set up your server directory and runtime options.</DialogDescription>
				</DialogHeader>
				<form onSubmit={onSubmit} className='space-y-6'>
					<FieldGroup>
						<ServerSetupFormFields
							form={form}
							onFieldChange={updateField}
							onPickDirectory={pickDirectory}
							onPickServerFile={pickServerFile}
							idPrefix='server'
							showDirectory
							showCreateDirectoryIfMissing
							showAutoAgreeEula
						/>
						{error && <p className='text-sm text-destructive'>{error}</p>}
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
