import * as React from 'react';
import { TriangleAlert } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import type { MserveJsonFormProps } from '@/lib/mserve-schema';
import { backupChoices } from '@/pages/server/server-constants';
import { toggleBackupMode } from '@/pages/server/server-utils';

type AutoBackupFieldsProps = {
	values: Pick<MserveJsonFormProps, 'auto_backup' | 'storage_limit' | 'auto_backup_interval'>;
	onFieldChange: <K extends keyof MserveJsonFormProps>(key: K, value: MserveJsonFormProps[K]) => void;
	idPrefix: string;
};

// Never below 0, but 0 is allowed while typing (an emptied field), so the user
// can clear it and type a new value; saving clamps to at least 1.
const parseNonNegative = (value: string, fallback: number) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
};

const reveal = {
	initial: { height: 0, marginTop: 0, opacity: 0 },
	animate: { height: 'auto', marginTop: 24, opacity: 1 },
	exit: { height: 0, marginTop: 0, opacity: 0 },
	transition: { type: 'spring', duration: 0.2, bounce: 0 },
} as const;

/** Auto-backup modes, plus the storage limit and interval they need. */
export const AutoBackupFields: React.FC<AutoBackupFieldsProps> = ({ values, onFieldChange, idPrefix }) => (
	<>
		<Field>
			<Label>Auto backup modes</Label>
			<div className='space-y-2'>
				{backupChoices.map((choice) => (
					<Label key={choice.value} className='flex items-center gap-3'>
						<Checkbox
							checked={values.auto_backup.includes(choice.value)}
							onCheckedChange={(checked) =>
								onFieldChange(
									'auto_backup',
									toggleBackupMode(values.auto_backup, choice.value, checked === true),
								)
							}
						/>
						{choice.label}
					</Label>
				))}
			</div>
		</Field>
		<AnimatePresence>
			{values.auto_backup.length > 0 && (
				<m.div {...reveal}>
					<Field>
						<Label htmlFor={`${idPrefix}-storage-limit`}>Backup storage limit</Label>
						<InputGroup>
							<InputGroupInput
								id={`${idPrefix}-storage-limit`}
								type='number'
								min={1}
								value={values.storage_limit}
								onChange={(event) =>
									onFieldChange('storage_limit', parseNonNegative(event.target.value, values.storage_limit))
								}
							/>
							<InputGroupAddon className='font-mono font-bold uppercase text-xs' align='inline-end'>
								Gigabytes
							</InputGroupAddon>
						</InputGroup>
						<p className='text-sm text-muted-foreground'>
							<TriangleAlert className='size-4 inline-flex mr-1 mb-0.5' />
							Backups can grow quickly. Set a limit to avoid filling the disk. The oldest backup(s) will
							be deleted once the limit is reached to make space for the new one.
						</p>
					</Field>
				</m.div>
			)}
		</AnimatePresence>
		<AnimatePresence>
			{values.auto_backup.includes('interval') && (
				<m.div {...reveal}>
					<Field>
						<Label htmlFor={`${idPrefix}-backup-interval`}>Backup interval</Label>
						<InputGroup>
							<InputGroupInput
								id={`${idPrefix}-backup-interval`}
								type='number'
								min={1}
								value={values.auto_backup_interval}
								onChange={(event) =>
									onFieldChange(
										'auto_backup_interval',
										parseNonNegative(event.target.value, values.auto_backup_interval),
									)
								}
							/>
							<InputGroupAddon className='font-mono font-bold uppercase text-xs' align='inline-end'>
								Minutes
							</InputGroupAddon>
						</InputGroup>
					</Field>
				</m.div>
			)}
		</AnimatePresence>
	</>
);
