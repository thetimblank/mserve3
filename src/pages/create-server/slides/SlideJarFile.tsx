import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Download, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { inferProviderFromJarPath, inferVersionFromJarPath } from '@/lib/server-provider-capabilities';
import { useCreateServer, type PathValidationResult } from '../CreateServerContext';
import JarDownloadModal, { type DownloadedJarSelection } from './components/JarDownloadModal';
import SlideShell from './SlideShell';

const SlideJarFile: React.FC = () => {
	const { form, updateField, nextSlide, setError, clearError } = useCreateServer();
	const [downloadModalOpen, setDownloadModalOpen] = React.useState(false);
	const [downloadButtonLabel, setDownloadButtonLabel] = React.useState('Browse & Download');
	const inferredProvider = React.useMemo(() => inferProviderFromJarPath(form.file), [form.file]);
	const inferredVersion = React.useMemo(() => inferVersionFromJarPath(form.file), [form.file]);

	const applyInferredMetadata = React.useCallback(
		(filePath: string) => {
			const provider = inferProviderFromJarPath(filePath);
			const version = inferVersionFromJarPath(filePath);
			updateField('provider', provider ?? '');
			updateField('version', version ?? '');
		},
		[updateField],
	);

	const onPickServerFile = async () => {
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
				applyInferredMetadata(selected);
				clearError();
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Could not open file picker.';
			setError(message);
		}
	};

	const onContinue = async () => {
		try {
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

			const normalizedProvider = (form.provider || inferredProvider || '').trim();
			if (!normalizedProvider) {
				setError('mserve could not infer the server provider. Enter a provider to continue.');
				return;
			}

			if (normalizedProvider !== form.provider) {
				updateField('provider', normalizedProvider);
			}

			if (!form.version && inferredVersion) {
				updateField('version', inferredVersion);
			}

			clearError();
			nextSlide();
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to validate jar file path.';
			setError(message);
		}
	};

	const onDownloadedJar = async (selection: DownloadedJarSelection) => {
		const fileValidation = await invoke<PathValidationResult>('validate_path', {
			path: selection.filePath,
		});

		if (!fileValidation.exists || !fileValidation.isFile) {
			throw new Error('Downloaded jar could not be validated. Please try again.');
		}

		updateField('file', selection.filePath);
		updateField('provider', selection.provider);
		updateField('version', selection.version);
		setDownloadButtonLabel(selection.selectionLabel);
		clearError();
		nextSlide();
	};

	return (
		<SlideShell
			title='Choose the server jar file'
			description='Point to the .jar file that starts this server.'
			actions={
				<Button type='button' onClick={onContinue}>
					Continue
				</Button>
			}>
			<div className='flex flex-col items-center gap-4'>
				<Field>
					<Label>Get a Jar Automatically</Label>
					<Button type='button' variant='outline' onClick={() => setDownloadModalOpen(true)}>
						<Download /> {downloadButtonLabel}
					</Button>
				</Field>
				<JarDownloadModal
					open={downloadModalOpen}
					onOpenChange={setDownloadModalOpen}
					onDownloaded={onDownloadedJar}
				/>
				<p className='text-muted-foreground font-bold select-none'>OR</p>
				<Field>
					<Label htmlFor='create-server-file'>Jar File Location</Label>
					<div className='flex gap-2'>
						<Input
							id='create-server-file'
							placeholder='C:\\servers\\server-1.21.11.jar'
							value={form.file}
							onChange={(event) => {
								const nextFile = event.target.value;
								updateField('file', nextFile);
								applyInferredMetadata(nextFile);
							}}
						/>
						<Button type='button' variant='outline' onClick={onPickServerFile}>
							<FolderOpen /> Browse
						</Button>
					</div>
				</Field>
				<Field>
					<Label htmlFor='create-server-provider'>Server Provider</Label>
					<Input
						id='create-server-provider'
						placeholder='paper, vanilla, fabric, velocity...'
						value={form.provider}
						onChange={(event) => updateField('provider', event.target.value)}
					/>
					<p className='text-xs text-muted-foreground'>
						{inferredProvider
							? `Detected from filename: ${inferredProvider}`
							: 'Provider could not be detected automatically from this filename.'}
					</p>
				</Field>
			</div>
		</SlideShell>
	);
};

export default SlideJarFile;
