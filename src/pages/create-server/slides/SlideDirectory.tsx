import * as React from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';

const importKinds = new Set(['import_mserve', 'import_existing_server']);

const SlideDirectory: React.FC = () => {
	const {
		form,
		isSubmitting,
		directoryInspection,
		updateField,
		nextSlide,
		setSlide,
		setSkipJarAndEula,
		setError,
		clearError,
		inspectServerDirectory,
		importServerFromDirectory,
		setDirectoryFromExistingServer,
	} = useCreateServer();

	const onPickDirectory = async () => {
		try {
			const selected = await openDialog({
				directory: true,
				multiple: false,
				title: 'Choose server directory',
			});

			if (typeof selected === 'string') {
				updateField('directory', selected);
				clearError();
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Could not open directory picker.';
			setError(message);
		}
	};

	React.useEffect(() => {
		const directory = form.directory.trim();
		if (!directory) {
			void inspectServerDirectory({ directory: '', silent: true });
			return;
		}

		const timeout = window.setTimeout(() => {
			void inspectServerDirectory({ silent: true });
		}, 220);

		return () => {
			window.clearTimeout(timeout);
		};
	}, [form.createDirectoryIfMissing, form.directory, inspectServerDirectory]);

	const onContinue = async () => {
		const inspection = await inspectServerDirectory();
		if (!inspection) return;

		switch (inspection.kind) {
			case 'new_directory':
			case 'empty_directory': {
				setSkipJarAndEula(false);
				clearError();
				nextSlide();
				return;
			}
			case 'import_mserve': {
				setSkipJarAndEula(false);
				await importServerFromDirectory();
				return;
			}
			case 'import_existing_server': {
				if (!inspection.firstJarFile) {
					setError('Could not detect a jar file for import.');
					return;
				}
				setSkipJarAndEula(true);
				setDirectoryFromExistingServer(inspection.firstJarFile);
				clearError();
				setSlide(3);
				return;
			}
			case 'empty_input':
			case 'missing_directory':
				setError(inspection.message);
				return;
			case 'already_in_mserve':
				setError(inspection.message);
				return;
			case 'not_directory':
			case 'unsupported_existing':
			default:
				setError(inspection.message);
		}
	};

	const buttonLabel = importKinds.has(directoryInspection?.kind ?? '') ? 'Import Server' : 'Continue';
	const showCreateDirectoryCheckbox =
		directoryInspection?.kind === 'missing_directory' || directoryInspection?.kind === 'new_directory';
	const showDirectoryNote =
		directoryInspection?.kind === 'import_mserve' ||
		directoryInspection?.kind === 'import_existing_server' ||
		directoryInspection?.kind === 'unsupported_existing' ||
		directoryInspection?.kind === 'not_directory';
	const noteTone =
		directoryInspection?.kind === 'unsupported_existing' ? 'text-destructive' : 'text-muted-foreground';

	return (
		<SlideShell
			title='Where should this server live?'
			description='Choose the folder for this server installation.'
			actions={
				<Button type='button' onClick={onContinue} disabled={isSubmitting}>
					{isSubmitting ? 'Working...' : buttonLabel}
				</Button>
			}>
			<FieldGroup className='gap-2'>
				<Field>
					<Label htmlFor='create-server-directory'>Server Location</Label>
					<div className='flex gap-2'>
						<Input
							id='create-server-directory'
							placeholder='C:\\servers\\MyServer'
							value={form.directory}
							onChange={(event) => updateField('directory', event.target.value)}
						/>
						<Button type='button' variant='outline' onClick={onPickDirectory} disabled={isSubmitting}>
							<FolderOpen /> Browse
						</Button>
					</div>
				</Field>
				{showCreateDirectoryCheckbox && (
					<Field>
						<Label className='flex items-center gap-3'>
							<Checkbox
								checked={form.createDirectoryIfMissing}
								onCheckedChange={(checked) =>
									updateField(
										'createDirectoryIfMissing',
										typeof checked === 'boolean' ? checked : false,
									)
								}
							/>
							Create directory since it does not exist
						</Label>
					</Field>
				)}
				{showDirectoryNote && directoryInspection && form.directory.trim() && (
					<p className={`text-sm ${noteTone}`}>{directoryInspection.message}</p>
				)}
			</FieldGroup>
		</SlideShell>
	);
};

export default SlideDirectory;
