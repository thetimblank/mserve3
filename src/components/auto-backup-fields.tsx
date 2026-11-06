import * as React from 'react';
import { AnimatePresence, m } from 'motion/react';
import { DurationPicker } from '@/components/duration-picker';
import { StorageLimitField } from '@/components/storage-limit-field';
import { ToggleCard } from '@/components/toggle-card';
import { Label } from '@/components/ui/label';
import { AUTO_BACKUP_INTERVAL_PRESETS_MINUTES } from '@/lib/mserve-consts';
import type { AutoBackupMode, MserveJsonFormProps } from '@/lib/mserve-schema';
import { toggleBackupMode } from '@/pages/server/server-utils';

type AutoBackupFieldsProps = {
	values: Pick<MserveJsonFormProps, 'auto_backup' | 'storage_limit' | 'auto_backup_interval'>;
	onFieldChange: <K extends keyof MserveJsonFormProps>(key: K, value: MserveJsonFormProps[K]) => void;
	idPrefix: string;
	/** The server folder (or the folder a new server goes in), to size the storage limit from its drive. */
	directory: string;
	/** Offer the "when it starts" mode too. The wizard leaves it out to stay short. */
	showOnStart?: boolean;
};

const reveal = {
	initial: { height: 0, opacity: 0 },
	animate: { height: 'auto', opacity: 1 },
	exit: { height: 0, opacity: 0 },
	transition: { type: 'spring', duration: 0.2, bounce: 0 },
} as const;

/** Automatic backup modes as toggle cards, plus the storage limit they share. */
export const AutoBackupFields: React.FC<AutoBackupFieldsProps> = ({
	values,
	onFieldChange,
	idPrefix,
	directory,
	showOnStart = true,
}) => {
	const isOn = (mode: AutoBackupMode) => values.auto_backup.includes(mode);
	const setMode = (mode: AutoBackupMode, enabled: boolean) =>
		onFieldChange('auto_backup', toggleBackupMode(values.auto_backup, mode, enabled));

	return (
		<div className='space-y-3'>
			<ToggleCard
				id={`${idPrefix}-backup-interval`}
				title='Back up on a timer'
				description='Saves a copy while the server is running.'
				checked={isOn('interval')}
				onCheckedChange={(enabled) => setMode('interval', enabled)}>
				<div className='space-y-2'>
					<Label id={`${idPrefix}-backup-interval-label`}>Back up every</Label>
					<DurationPicker
						aria-labelledby={`${idPrefix}-backup-interval-label`}
						value={values.auto_backup_interval}
						presets={AUTO_BACKUP_INTERVAL_PRESETS_MINUTES}
						min={1}
						onValueChange={(minutes) => onFieldChange('auto_backup_interval', minutes)}
					/>
				</div>
			</ToggleCard>
			<ToggleCard
				id={`${idPrefix}-backup-on-close`}
				title='Back up when it stops'
				description='Saves a copy each time the server stops or crashes.'
				checked={isOn('on_close')}
				onCheckedChange={(enabled) => setMode('on_close', enabled)}
			/>
			{showOnStart && (
				<ToggleCard
					id={`${idPrefix}-backup-on-start`}
					title='Back up when it starts'
					description='Saves a copy right after the server starts.'
					checked={isOn('on_start')}
					onCheckedChange={(enabled) => setMode('on_start', enabled)}
				/>
			)}
			<AnimatePresence initial={false}>
				{values.auto_backup.length > 0 && (
					<m.div {...reveal} className='overflow-hidden'>
						<div className='pt-3'>
							<StorageLimitField
								id={`${idPrefix}-storage-limit`}
								value={values.storage_limit}
								onChange={(gb) => onFieldChange('storage_limit', gb)}
								directory={directory}
							/>
						</div>
					</m.div>
				)}
			</AnimatePresence>
		</div>
	);
};
