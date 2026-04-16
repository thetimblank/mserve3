import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AutoBackupMode } from '@/lib/mserve-sync';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';
import { AnimatePresence, m } from 'motion/react';

const backupChoices: { value: AutoBackupMode; label: string }[] = [
	{ value: 'interval', label: 'Interval' },
	{ value: 'on_close', label: 'On close' },
	{ value: 'on_start', label: 'On start' },
];

const SlideBackups: React.FC = () => {
	const { form, updateField, continueToNext } = useCreateServer();

	const toggleBackupMode = (mode: AutoBackupMode, enabled: boolean) => {
		updateField(
			'autoBackup',
			enabled
				? Array.from(new Set([...form.autoBackup, mode]))
				: form.autoBackup.filter((item) => item !== mode),
		);
	};

	const parsePositive = (value: string, fallback: number) => {
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return fallback;
		return Math.max(1, parsed);
	};

	return (
		<SlideShell
			title='Backup settings'
			description='Choose backup behavior and limits.'
			actions={
				<Button type='button' onClick={continueToNext}>
					Continue
				</Button>
			}>
			<FieldGroup className='gap-0 bg-secondary p-6 rounded-lg'>
				<Field>
					<Label>Auto backup modes</Label>
					<div className='space-y-2'>
						{backupChoices.map((choice) => (
							<Label key={choice.value} className='flex items-center gap-3'>
								<Checkbox
									className='border-secondary-foreground/50'
									checked={form.autoBackup.includes(choice.value)}
									onCheckedChange={(checked) =>
										toggleBackupMode(choice.value, typeof checked === 'boolean' ? checked : false)
									}
								/>
								{choice.label}
							</Label>
						))}
					</div>
				</Field>
				<AnimatePresence>
					{form.autoBackup.length > 0 && (
						<m.div
							initial={{ height: 0, marginTop: 0, opacity: 0 }}
							animate={{ height: 'auto', marginTop: 24, opacity: 1 }}
							exit={{ height: 0, marginTop: 0, opacity: 0 }}
							transition={{ type: 'spring', duration: 0.2, bounce: 0 }}>
							<Field>
								<Label htmlFor='create-server-storage-limit'>Backup storage limit (GB)</Label>
								<Input
									className='border-secondary-foreground/50'
									id='create-server-storage-limit'
									type='number'
									value={form.storageLimit}
									onChange={(event) =>
										updateField(
											'storageLimit',
											parsePositive(event.target.value, form.storageLimit),
										)
									}
									min={1}
								/>
								<p className='text-sm text-muted-foreground flex gap-2 items-center'>
									<TriangleAlert className='size-4 shrink-0' />
									Backups can grow quickly. Set a limit to avoid filling the disk.
								</p>
							</Field>
						</m.div>
					)}
				</AnimatePresence>
				<AnimatePresence>
					{form.autoBackup.includes('interval') && (
						<m.div
							initial={{ height: 0, marginTop: 0, opacity: 0 }}
							animate={{ height: 'auto', marginTop: 24, opacity: 1 }}
							exit={{ height: 0, marginTop: 0, opacity: 0 }}
							transition={{ type: 'spring', duration: 0.2, bounce: 0 }}>
							<Field>
								<Label htmlFor='create-server-backup-interval'>Backup interval (minutes)</Label>
								<Input
									className='border-secondary-foreground/50'
									id='create-server-backup-interval'
									type='number'
									value={form.autoBackupInterval}
									onChange={(event) =>
										updateField(
											'autoBackupInterval',
											parsePositive(event.target.value, form.autoBackupInterval),
										)
									}
									min={1}
								/>
							</Field>
						</m.div>
					)}
				</AnimatePresence>
			</FieldGroup>
		</SlideShell>
	);
};

export default SlideBackups;
