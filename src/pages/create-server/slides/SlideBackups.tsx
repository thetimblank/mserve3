import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import type { AutoBackupMode } from '@/lib/mserve-sync';
import { backupChoices } from '@/pages/server/server-constants';
import { toggleBackupMode as toggleBackupModeValue } from '@/pages/server/server-utils';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';
import { AnimatePresence, m } from 'motion/react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Container } from '@/components/ui/container';

const SlideBackups: React.FC = () => {
	const { form, updateField, continueToNext } = useCreateServer();

	const handleToggleBackupMode = (mode: AutoBackupMode, enabled: boolean) => {
		updateField('auto_backup', toggleBackupModeValue(form.auto_backup, mode, enabled));
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
			<FieldGroup className='gap-0'>
				<Container>
					<Field>
						<Label>Auto backup modes</Label>
						<div className='space-y-2'>
							{backupChoices.map((choice) => (
								<Label key={choice.value} className='flex items-center gap-3'>
									<Checkbox
										checked={form.auto_backup.includes(choice.value)}
										onCheckedChange={(checked) =>
											handleToggleBackupMode(
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
					<AnimatePresence>
						{form.auto_backup.length > 0 && (
							<m.div
								initial={{ height: 0, marginTop: 0, opacity: 0 }}
								animate={{ height: 'auto', marginTop: 24, opacity: 1 }}
								exit={{ height: 0, marginTop: 0, opacity: 0 }}
								transition={{ type: 'spring', duration: 0.2, bounce: 0 }}>
								<Field>
									<Label htmlFor='create-server-storage-limit'>Backup storage limit</Label>
									<InputGroup>
										<InputGroupInput
											id='create-server-storage-limit'
											type='number'
											value={form.storage_limit}
											onChange={(event) =>
												updateField(
													'storage_limit',
													parsePositive(event.target.value, form.storage_limit),
												)
											}
											min={1}
										/>
										<InputGroupAddon
											className='font-mono font-bold uppercase text-xs'
											align='inline-end'>
											Gigabytes
										</InputGroupAddon>
									</InputGroup>
									<p className='text-sm text-muted-foreground flex gap-2 items-center'>
										<TriangleAlert className='size-4 shrink-0' />
										Backups can grow quickly. Set a limit to avoid filling the disk.
									</p>
								</Field>
							</m.div>
						)}
					</AnimatePresence>
					<AnimatePresence>
						{form.auto_backup.includes('interval') && (
							<m.div
								initial={{ height: 0, marginTop: 0, opacity: 0 }}
								animate={{ height: 'auto', marginTop: 24, opacity: 1 }}
								exit={{ height: 0, marginTop: 0, opacity: 0 }}
								transition={{ type: 'spring', duration: 0.2, bounce: 0 }}>
								<Field>
									<Label htmlFor='create-server-backup-interval'>Backup Interval</Label>
									<InputGroup>
										<InputGroupInput
											id='create-server-backup-interval'
											type='number'
											value={form.auto_backup_interval}
											onChange={(event) =>
												updateField(
													'auto_backup_interval',
													parsePositive(event.target.value, form.auto_backup_interval),
												)
											}
											min={1}
										/>
										<InputGroupAddon
											className='font-mono font-bold uppercase text-xs'
											align='inline-end'>
											Minutes
										</InputGroupAddon>
									</InputGroup>
								</Field>
							</m.div>
						)}
					</AnimatePresence>
				</Container>
			</FieldGroup>
		</SlideShell>
	);
};

export default SlideBackups;
