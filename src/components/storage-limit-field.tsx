import * as React from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useStorageRecommendation } from '@/hooks/use-storage-recommendation';
import { DEFAULT_STORAGE_LIMIT_GB } from '@/lib/mserve-consts';
import { bytesToWholeGb, formatDriveLabel } from '@/lib/storage-recommendation';

type StorageLimitFieldProps = {
	id: string;
	/** The backup storage limit, in GB. */
	value: number;
	onChange: (gb: number) => void;
	/** The server folder, or the folder a new server will be created in. */
	directory: string;
	label?: string;
	description?: string;
};

const STORAGE_LIMIT_MIN_GB = 1;

/** Backup storage limit slider, sized and recommended from the server folder's drive. */
export const StorageLimitField: React.FC<StorageLimitFieldProps> = ({
	id,
	value,
	onChange,
	directory,
	label = 'Space for backups',
	description = 'When backups reach this size, the oldest ones are deleted to make room.',
}) => {
	const { disk, recommendation, isUnavailable } = useStorageRecommendation(directory);
	const current = Math.max(STORAGE_LIMIT_MIN_GB, Math.round(Number(value) || STORAGE_LIMIT_MIN_GB));
	// Never shrink the slider below the saved value, so opening it doesn't change it.
	const max = Math.max(recommendation?.sliderMaxGb ?? DEFAULT_STORAGE_LIMIT_GB, current);

	return (
		<Field>
			<div className='flex items-center justify-between gap-3'>
				<Label htmlFor={id}>{label}</Label>
				<p className='text-sm font-medium text-muted-foreground'>{current} GB</p>
			</div>
			<Slider
				id={id}
				value={[current]}
				min={STORAGE_LIMIT_MIN_GB}
				max={max}
				step={1}
				onValueChange={(next) => onChange(next[0] ?? current)}
			/>
			{recommendation && disk ? (
				<div className='flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground'>
					<span>
						Recommended {recommendation.recommendedGb} GB · {bytesToWholeGb(disk.availableBytes)} GB free on{' '}
						{formatDriveLabel(disk.mountPoint)}
					</span>
					{current !== recommendation.recommendedGb && (
						<Button
							type='button'
							variant='link'
							size='xs'
							className='px-0'
							onClick={() => onChange(recommendation.recommendedGb)}>
							Use recommended
						</Button>
					)}
				</div>
			) : (
				!isUnavailable && <p className='text-sm text-muted-foreground'>Checking free space…</p>
			)}
			{recommendation?.isLowDisk && (
				<p className='flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400'>
					<TriangleAlert className='size-4 shrink-0' />
					This drive is almost full. Free up space so backups have room.
				</p>
			)}
			<p className='text-sm text-muted-foreground'>{description}</p>
		</Field>
	);
};
