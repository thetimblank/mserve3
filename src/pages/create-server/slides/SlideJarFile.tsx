import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateServer, type PathValidationResult } from '../CreateServerContext';
import SlideShell from './SlideShell';

const SlideJarFile: React.FC = () => {
	const { form, updateField, nextSlide, setError, clearError } = useCreateServer();

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

			clearError();
			nextSlide();
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to validate jar file path.';
			setError(message);
		}
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
			<Field>
				<Label htmlFor='create-server-file'>Server Jar File Location</Label>
				<div className='flex gap-2'>
					<Input
						id='create-server-file'
						placeholder='C:\\servers\\server-1.21.11.jar'
						value={form.file}
						onChange={(event) => updateField('file', event.target.value)}
					/>
					<Button type='button' variant='outline' onClick={onPickServerFile}>
						<FolderOpen /> Browse
					</Button>
				</div>
			</Field>
		</SlideShell>
	);
};

export default SlideJarFile;
