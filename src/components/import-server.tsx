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
import { useServers } from '@/data/servers';
import { buildImportedServer, getServerNameFromDirectory } from '@/lib/mserve-server-mapper';
import { type InitServerResult, syncMserveJsonWithRepair } from '@/lib/mserve-sync';
import { createProvider } from '@/lib/server-provider';
import { examplePaths, isWindows } from '@/lib/platform';
import { FolderOpen, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { getErrorMessage } from '@/lib/utils';

const defaultData = {
	directory: '',
};

// Only Windows paths are case-insensitive; on Linux `/srv/MC` and `/srv/mc` are two servers.
const normalizeDirectoryPath = (value: string) => {
	const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
	return isWindows ? normalized.toLowerCase() : normalized;
};

const ImportServer: React.FC<React.HTMLAttributes<HTMLButtonElement>> = ({ ...props }) => {
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
			const message = getErrorMessage(err, 'Could not open directory picker.');
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

				const synced = await syncMserveJsonWithRepair(result.directory, (fallback) => ({
					...fallback,
					file: result.file || 'server.jar',
					provider: createProvider(fallback.provider, { file: fallback.file }),
				}));
				if (!synced) {
					throw new Error('Import cancelled because mserve.json rebuild was not completed.');
				}

				addServer(buildImportedServer(result, synced.config));
				return {
					usedRepairDialog: synced.repaired,
					autoRepaired: synced.updated,
				};
			})();

			// `toast.promise` returns the toast id; `unwrap()` is what waits.
			await toast
				.promise(importAndSyncPromise, {
					loading: 'Importing server...',
					success: (result) =>
						result.usedRepairDialog
							? `Server "${getServerNameFromDirectory(directory)}" was imported and rebuilt mserve.json`
							: result.autoRepaired
								? `Server "${getServerNameFromDirectory(directory)}" was imported and automatically repaired mserve.json`
								: `Server "${getServerNameFromDirectory(directory)}" has been imported`,
					error: (err) => getErrorMessage(err, 'Failed to import server.'),
				})
				.unwrap();

			resetForm();
			setOpen(false);
		} catch (err) {
			const message = getErrorMessage(err, 'Failed to import server.');
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
									placeholder={examplePaths.serverDirectory}
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
