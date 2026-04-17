'use client';

import * as React from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { ServerSetupFormFields } from '@/components/server-setup-form-fields';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import {
	type PromptMserveRepairOptions,
	type RepairMserveJsonPayload,
	type ServerSetupFormData,
	createDefaultServerSetupForm,
} from '@/lib/mserve-sync';
import { registerMserveRepairHandler } from '@/lib/mserve-repair-controller';

type RepairRequest = {
	options: PromptMserveRepairOptions;
	resolve: (value: RepairMserveJsonPayload | null) => void;
};

const toInitialForm = (options: PromptMserveRepairOptions): ServerSetupFormData => ({
	directory: options.directory,
	createDirectoryIfMissing: options.createDirectoryIfMissing ?? true,
	file: options.file,
	ram: options.ram,
	storageLimit: options.storageLimit,
	autoRestart: options.autoRestart,
	autoBackup: options.autoBackup,
	autoBackupInterval: options.autoBackupInterval,
	autoAgreeEula: options.autoAgreeEula ?? true,
	javaInstallation: options.javaInstallation ?? '',
	provider: options.provider ?? '',
	version: options.version ?? '',
});

const MserveRepairDialog: React.FC = () => {
	const queueRef = React.useRef<RepairRequest[]>([]);
	const [activeRequest, setActiveRequest] = React.useState<RepairRequest | null>(null);
	const [form, setForm] = React.useState<ServerSetupFormData>(() => createDefaultServerSetupForm());
	const [error, setError] = React.useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = React.useState(false);

	const consumeQueue = React.useCallback(() => {
		if (activeRequest) return;
		const next = queueRef.current.shift() ?? null;
		if (!next) return;
		setActiveRequest(next);
		setForm(toInitialForm(next.options));
		setError(null);
		setIsSubmitting(false);
	}, [activeRequest]);

	React.useEffect(() => {
		const unregister = registerMserveRepairHandler((request) => {
			queueRef.current.push(request);
			setActiveRequest((current) => current ?? queueRef.current.shift() ?? null);
		});
		return unregister;
	}, []);

	React.useEffect(() => {
		if (!activeRequest) return;
		setForm(toInitialForm(activeRequest.options));
		setError(null);
		setIsSubmitting(false);
	}, [activeRequest]);

	const closeWith = React.useCallback(
		(value: RepairMserveJsonPayload | null) => {
			if (!activeRequest) return;
			activeRequest.resolve(value);
			setActiveRequest(null);
			setTimeout(() => consumeQueue(), 0);
		},
		[activeRequest, consumeQueue],
	);

	const updateField = <K extends keyof ServerSetupFormData>(key: K, value: ServerSetupFormData[K]) => {
		setForm((prev) => ({ ...prev, [key]: value }));
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

	const onSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!activeRequest) return;

		setIsSubmitting(true);
		setError(null);

		const file = form.file.trim();
		if (!file) {
			setError('Please choose a server jar file.');
			setIsSubmitting(false);
			return;
		}

		if (!file.toLowerCase().endsWith('.jar')) {
			setError('Server file must be a .jar file.');
			setIsSubmitting(false);
			return;
		}

		closeWith({
			directory: activeRequest.options.directory,
			createDirectoryIfMissing: form.createDirectoryIfMissing,
			file,
			ram: Math.max(1, Number(form.ram) || 3),
			storageLimit: Math.max(1, Number(form.storageLimit) || 200),
			autoBackup: form.autoBackup,
			autoBackupInterval: Math.max(1, Number(form.autoBackupInterval) || 120),
			autoRestart: form.autoRestart,
			autoAgreeEula: form.autoAgreeEula,
			javaInstallation: form.javaInstallation,
			customFlags: activeRequest.options.customFlags,
			provider: activeRequest.options.provider,
			version: activeRequest.options.version,
		});
	};

	return (
		<Dialog open={!!activeRequest} onOpenChange={(open) => !open && closeWith(null)}>
			<DialogContent className='min-w-2xl'>
				<DialogHeader>
					<DialogTitle>Invalid mserve.json found</DialogTitle>
					<DialogDescription>
						The data found was invalid. Please enter updated server settings to rebuild mserve.json.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={onSubmit} className='space-y-6'>
					<FieldGroup>
						<ServerSetupFormFields
							form={form}
							onFieldChange={updateField}
							onPickServerFile={pickServerFile}
							idPrefix='repair'
							showDirectory={false}
							showCreateDirectoryIfMissing={false}
							showAutoAgreeEula={false}
						/>
						{error && <p className='text-sm text-destructive'>{error}</p>}
					</FieldGroup>
					<DialogFooter>
						<Button
							variant='outline'
							type='button'
							onClick={() => closeWith(null)}
							disabled={isSubmitting}>
							Cancel
						</Button>
						<Button type='submit' disabled={isSubmitting}>
							{isSubmitting ? 'Rebuilding...' : 'Rebuild mserve.json'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};

export default MserveRepairDialog;
