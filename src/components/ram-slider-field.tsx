'use client';

import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CircleAlert, Info } from 'lucide-react';
import { useUser } from '@/data/user';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type RamSliderFieldProps = {
	id: string;
	value: number;
	onChange: (value: number) => void;
	className?: string;
};

type NavigatorWithDeviceMemory = Navigator & {
	deviceMemory?: number;
};

const ramMarkers = [1, 2, 3, 5, 10];
const warningBufferGb = 4;

const getNavigatorMemoryLimitGb = () => {
	if (typeof navigator === 'undefined') return 16;
	const deviceMemory = Number((navigator as NavigatorWithDeviceMemory).deviceMemory);
	if (!Number.isFinite(deviceMemory) || deviceMemory < 1) return 16;
	return Math.max(1, Math.ceil(deviceMemory));
};

const toRamMarkerPercent = (marker: number, max: number) => {
	if (max <= 1) return 0;
	return ((marker - 1) / (max - 1)) * 100;
};

const toRamGradientPercent = (marker: number, max: number) => {
	if (max <= 0) return 0;
	return (Math.max(0, Math.min(marker, max)) / max) * 100;
};

const buildRamGradient = (maxRam: number) => {
	const yellowStartPercent = toRamGradientPercent(1, maxRam);
	const greenStartPercent = toRamGradientPercent(4, maxRam);
	const yellowReturnPercent = toRamGradientPercent(10, maxRam);
	const redReturnPercent = toRamGradientPercent(16, maxRam);

	return `linear-gradient(90deg, #ef4444 0%, #facc15 ${yellowStartPercent}%, #22c55e ${greenStartPercent}%, #22c55e ${yellowReturnPercent}%, #facc15 ${redReturnPercent}%, #ef4444 100%)`;
};

const RamSliderField: React.FC<RamSliderFieldProps> = ({ id, value, onChange, className }) => {
	const { user } = useUser();
	const fallbackMemoryLimitGb = React.useMemo(() => getNavigatorMemoryLimitGb(), []);
	const [systemMemoryLimitGb, setSystemMemoryLimitGb] = React.useState(fallbackMemoryLimitGb);

	React.useEffect(() => {
		let active = true;

		void invoke<number>('get_system_memory_gb')
			.then((memoryGb) => {
				if (!active) return;
				const parsed = Number(memoryGb);
				if (!Number.isFinite(parsed) || parsed < 1) {
					setSystemMemoryLimitGb(fallbackMemoryLimitGb);
					return;
				}
				setSystemMemoryLimitGb(Math.ceil(parsed));
			})
			.catch(() => {
				if (!active) return;
				setSystemMemoryLimitGb(fallbackMemoryLimitGb);
			});

		return () => {
			active = false;
		};
	}, [fallbackMemoryLimitGb]);

	const maxRam = Math.max(10, systemMemoryLimitGb);
	const warningStartRam = Math.max(1, maxRam - warningBufferGb);
	const isAdvancedModeEnabled = user.advanced_mode;
	const maxSelectableRam = isAdvancedModeEnabled ? maxRam : warningStartRam;
	const clampedRam = Math.max(1, Math.min(value, maxSelectableRam));
	const showRiskWarning = isAdvancedModeEnabled && clampedRam >= warningStartRam;
	const showCapNotice = !isAdvancedModeEnabled && maxSelectableRam < maxRam;
	const proxyGradient = React.useMemo(() => buildRamGradient(maxSelectableRam), [maxSelectableRam]);
	const visibleRamMarkers = React.useMemo(
		() => ramMarkers.filter((marker) => marker >= 1 && marker <= maxSelectableRam),
		[maxSelectableRam],
	);

	React.useEffect(() => {
		if (value !== clampedRam) {
			onChange(clampedRam);
		}
	}, [clampedRam, onChange, value]);

	return (
		<Field className={className}>
			<div className='flex items-center justify-between gap-3'>
				<Tooltip>
					<Label htmlFor={id}>
						Memory (RAM){' '}
						<TooltipTrigger>
							<Info className='size-4' />
						</TooltipTrigger>
					</Label>

					<TooltipContent className='text-center'>
						The more RAM the better up to a point.
						<br /> Too much can also cause system instability.
						<br /> (detected system memory: {systemMemoryLimitGb} GB).
					</TooltipContent>
				</Tooltip>
				<p className='text-sm font-medium text-muted-foreground'>{clampedRam} GB</p>
			</div>
			<Slider
				id={id}
				value={[clampedRam]}
				min={1}
				max={maxSelectableRam}
				step={1}
				trackStyle={{ background: proxyGradient }}
				rangeClassName='bg-transparent'
				onValueChange={(nextValue) => onChange(nextValue[0] ?? 1)}
			/>
			<div className='relative h-1'>
				{visibleRamMarkers.map((marker) => (
					<div
						key={marker}
						className='absolute -top-[250%] -translate-x-1/2'
						style={{ left: `${toRamMarkerPercent(marker, maxSelectableRam)}%` }}>
						<span className='text-[12px] h-1 text-muted-foreground'>{marker}</span>
					</div>
				))}
			</div>
			{showRiskWarning && (
				<p className='text-sm text-muted-foreground flex gap-2 items-center'>
					<CircleAlert className='size-4 shrink-0' />
					This much RAM may cause system instability.
				</p>
			)}
			{showCapNotice && (
				<p className='text-sm text-muted-foreground flex gap-2 items-center'>
					<CircleAlert className='size-4 shrink-0' />
					Advanced mode is off, so max RAM is capped at {maxSelectableRam} GB.
				</p>
			)}
		</Field>
	);
};

export default React.memo(RamSliderField);
