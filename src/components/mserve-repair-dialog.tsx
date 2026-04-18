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
	create_directory_if_missing: options.create_directory_if_missing ?? true,
	file: options.file,
	ram: options.ram,
	storage_limit: options.storage_limit,
	auto_restart: options.auto_restart,
	auto_backup: options.auto_backup,
	auto_backup_interval: options.auto_backup_interval,
	auto_agree_eula: options.auto_agree_eula ?? true,
	java_installation: options.java_installation ?? '',
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
			create_directory_if_missing: form.create_directory_if_missing,
			file,
			ram: Math.max(1, Number(form.ram) || 3),
			storage_limit: Math.max(1, Number(form.storage_limit) || 200),
			auto_backup: form.auto_backup,
			auto_backup_interval: Math.max(1, Number(form.auto_backup_interval) || 120),
			auto_restart: form.auto_restart,
			auto_agree_eula: form.auto_agree_eula,
			java_installation: form.java_installation,
			custom_flags: activeRequest.options.custom_flags,
			provider: activeRequest.options.provider,
			version: activeRequest.options.version,
			provider_checks: activeRequest.options.provider_checks,
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
