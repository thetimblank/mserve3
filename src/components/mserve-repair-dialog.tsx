'use client';

import * as React from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ButtonGroup } from '@/components/ui/button-group';
import {
	type AutoBackupMode,
	type PromptMserveRepairOptions,
	type RepairMserveJsonPayload,
} from '@/lib/mserve-sync';
import { registerMserveRepairHandler } from '@/lib/mserve-repair-controller';

type RepairRequest = {
	options: PromptMserveRepairOptions;
	resolve: (value: RepairMserveJsonPayload | null) => void;
};

const backupChoices: { value: AutoBackupMode; label: string }[] = [
	{ value: 'interval', label: 'Interval' },
	{ value: 'on_close', label: 'On close' },
	{ value: 'on_start', label: 'On start' },
];

const toInitialForm = (options: PromptMserveRepairOptions) => ({
	file: options.file,
	ram: options.ram,
	autoBackup: options.auto_backup,
	autoBackupInterval: options.auto_backup_interval,
	autoRestart: options.auto_restart,
});

const MserveRepairDialog: React.FC = () => {
	const queueRef = React.useRef<RepairRequest[]>([]);
	const [activeRequest, setActiveRequest] = React.useState<RepairRequest | null>(null);
	const [form, setForm] = React.useState(() =>
		toInitialForm({
			directory: '',
			file: 'server.jar',
			ram: 3,
			auto_backup: [],
			auto_backup_interval: 120,
			auto_restart: false,
			explicit_info_names: false,
			custom_flags: [],
		}),
	);
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

	const updateField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
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
			file,
			ram: Math.max(1, Number(form.ram) || 3),
			auto_backup: form.autoBackup,
			auto_backup_interval: Math.max(1, Number(form.autoBackupInterval) || 120),
			auto_restart: form.autoRestart,
			explicit_info_names: activeRequest.options.explicit_info_names,
			custom_flags: activeRequest.options.custom_flags,
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
						<Field>
							<Label htmlFor='repair-server-file'>Server Jar File Location</Label>
							<div className='flex gap-2'>
								<Input
									id='repair-server-file'
									placeholder='C:\\servers\\server-1.21.11.jar'
									value={form.file}
									onChange={(event) => updateField('file', event.target.value)}
									required
								/>
								<Button type='button' variant='outline' onClick={pickServerFile}>
									<FolderOpen /> Browse
								</Button>
							</div>
						</Field>
						<Field>
							<Label htmlFor='repair-server-ram'>RAM (GB)</Label>
							<div className='flex gap-3 items-center'>
								<ButtonGroup>
									<Button
										type='button'
										variant={form.ram === 1 ? 'default' : 'outline'}
										onClick={() => updateField('ram', 1)}>
										Very Low (1)
									</Button>
									<Button
										type='button'
										variant={form.ram === 2 ? 'default' : 'outline'}
										onClick={() => updateField('ram', 2)}>
										Low (2)
									</Button>
									<Button
										type='button'
										variant={form.ram === 3 ? 'default' : 'outline'}
										onClick={() => updateField('ram', 3)}>
										Medium (3)
									</Button>
									<Button
										type='button'
										variant={form.ram === 5 ? 'default' : 'outline'}
										onClick={() => updateField('ram', 5)}>
										High (5)
									</Button>
									<Button
										type='button'
										variant={form.ram === 10 ? 'default' : 'outline'}
										onClick={() => updateField('ram', 10)}>
										Very High (10)
									</Button>
								</ButtonGroup>
								<p className='font-bold text-muted-foreground'>OR</p>
								<Input
									id='repair-server-ram'
									type='number'
									min={1}
									value={form.ram}
									onChange={(event) => updateField('ram', Number(event.target.value) || 3)}
									className='max-w-24'
								/>
							</div>
						</Field>
						<Field>
							<Label>Auto Backup</Label>
							<div className='flex gap-4 mt-2'>
								{backupChoices.map((choice) => (
									<Label key={choice.value} className='flex items-center gap-2'>
										<Checkbox
											checked={form.autoBackup.includes(choice.value)}
											onCheckedChange={(checked) =>
												toggleBackupMode(
													choice.value,
													typeof checked === 'boolean' ? checked : false,
												)
											}
										/>
										{choice.label}
									</Label>
								))}
							</div>
						</Field>
						<Field>
							<Label htmlFor='repair-server-auto-backup-interval'>
								Auto Backup Interval (minutes)
							</Label>
							<Input
								id='repair-server-auto-backup-interval'
								type='number'
								min={1}
								value={form.autoBackupInterval}
								onChange={(event) =>
									updateField('autoBackupInterval', Number(event.target.value) || 120)
								}
							/>
						</Field>
						<Field>
							<Label className='flex items-center gap-3'>
								<Checkbox
									checked={form.autoRestart}
									onCheckedChange={(checked) =>
										updateField('autoRestart', typeof checked === 'boolean' ? checked : false)
									}
								/>
								Auto Restart
							</Label>
						</Field>
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
