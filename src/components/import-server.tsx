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
import { Server, useServers } from '@/data/servers';
import { repairServerMserveJson, syncServerMserveJson, type SyncedMserveConfig } from '@/lib/mserve-sync';
import { requestMserveRepair } from '@/lib/mserve-repair-controller';
import { FolderOpen, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

const defaultData = {
	directory: '',
};

type InitServerResult = {
	ok: boolean;
	message: string;
	id: string;
	file: string;
	directory: string;
};

const getDirectoryName = (directory: string) => {
	const segments = directory.split(/[\\/]/).filter(Boolean);
	return segments[segments.length - 1] || 'Server';
};

const normalizeDirectoryPath = (value: string) =>
	value.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const buildServer = (result: InitServerResult, config: SyncedMserveConfig, storageLimit: number): Server => ({
	id: config.id || result.id,
	name: getDirectoryName(result.directory),
	directory: result.directory,
	status: 'offline',
	backups: [],
	datapacks: [],
	worlds: [],
	plugins: [],
	storage_limit: Math.max(1, Number(config.storage_limit ?? storageLimit) || 200),
	stats: {
		players: 0,
		capacity: 20,
		tps: 0,
		uptime: null,
	},
	file: config.file,
	ram: config.ram,
	auto_backup: config.auto_backup,
	auto_backup_interval: config.auto_backup_interval,
	auto_restart: config.auto_restart,
	java_installation: config.java_installation,
	custom_flags: config.custom_flags,
	provider: config.provider,
	version: config.version,
	created_at: new Date(config.created_at),
});

export const ImportServer: React.FC<React.HTMLAttributes<HTMLButtonElement>> = ({ ...props }) => {
	const navigate = useNavigate();
	const { servers, addServer } = useServers();
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
			setError('Please choose a server directory.');
			return;
		}

		const normalizedDirectory = normalizeDirectoryPath(directory);
		const existingServer =
			servers.find((server) => normalizeDirectoryPath(server.directory) === normalizedDirectory) ?? null;
		if (existingServer) {
			toast.info(
				`Nothing was imported. This server already exists in MSERVE as "${existingServer.name}".`,
			);
			resetForm();
			setOpen(false);
			navigate(`/servers/${encodeURIComponent(existingServer.id)}`);
			return;
		}

		setIsSubmitting(true);
		try {
			const importPromise = (async () => {
				const res = await invoke<InitServerResult>('import_server', { directory });
				if (!res.ok) {
					throw new Error(res.message || 'Failed to import server.');
				}
				return res;
			})();
			const importAndSyncPromise = (async () => {
				const result = await importPromise;

				let synced = await syncServerMserveJson(result.directory);
				let usedRepairDialog = false;
				let storageLimit = 200;

				if (synced.status === 'needs_setup') {
					const repairPayload = await requestMserveRepair({
						directory: result.directory,
						file: result.file || 'server.jar',
						ram: synced.config?.ram ?? 3,
						storageLimit,
						autoBackup: synced.config?.auto_backup ?? [],
						autoBackupInterval: synced.config?.auto_backup_interval ?? 120,
						autoRestart: synced.config?.auto_restart ?? false,
						createDirectoryIfMissing: true,
						autoAgreeEula: true,
						javaInstallation: synced.config?.java_installation ?? '',
						customFlags: synced.config?.custom_flags ?? [],
						provider: synced.config?.provider,
						version: synced.config?.version,
					});

					if (!repairPayload) {
						throw new Error('Import cancelled because mserve.json rebuild was not completed.');
					}

					storageLimit = repairPayload.storageLimit;
					synced = await repairServerMserveJson(repairPayload);
					usedRepairDialog = true;
				}

				if (!synced.config) {
					throw new Error('Could not resolve valid mserve.json data for this server.');
				}

				addServer(buildServer(result, synced.config, storageLimit));
				return {
					usedRepairDialog,
					autoRepaired: synced.updated,
				};
			})();

			await toast.promise(importAndSyncPromise, {
				loading: 'Importing server...',
				success: (result) =>
					result.usedRepairDialog
						? `Server "${getDirectoryName(directory)}" was imported and rebuilt mserve.json`
						: result.autoRepaired
							? `Server "${getDirectoryName(directory)}" was imported and automatically repaired mserve.json`
							: `Server "${getDirectoryName(directory)}" has been imported`,
				error: (err) => (err instanceof Error ? err.message : 'Failed to import server.'),
			});

			resetForm();
			setOpen(false);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to import server.';
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
						The server will automatically be made compatible with mserve. If no mserve.json is found,
						one will be created with default settings.
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
