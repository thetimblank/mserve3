import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CircleAlert, Info } from 'lucide-react';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
	formatHeapSize,
	formatRamLabel,
	RAM_MIN_GB,
	ramToSliderFraction,
	sliderFractionToRam,
} from '@/lib/ram-utils';

type RamSliderFieldProps = {
	id: string;
	value: number;
	onChange: (value: number) => void;
	className?: string;
};

type NavigatorWithDeviceMemory = Navigator & {
	deviceMemory?: number;
};

const ramMarkers = [0.25, 0.5, 1, 2, 4, 8, 16, 24, 32];
const warningBufferGb = 4;
/** Resolution of the underlying linear slider; RAM is derived from this position
 *  via the skewed scale, then snapped back to {@link RAM_MIN_GB} (256 MB) steps. */
const SLIDER_RESOLUTION = 1000;

const getNavigatorMemoryLimitGb = () => {
	if (typeof navigator === 'undefined') return 16;
	const deviceMemory = Number((navigator as NavigatorWithDeviceMemory).deviceMemory);
	if (!Number.isFinite(deviceMemory) || deviceMemory < 1) return 16;
	return Math.max(1, Math.ceil(deviceMemory));
};

const toRamPercent = (marker: number, max: number) => ramToSliderFraction(marker, RAM_MIN_GB, max) * 100;

const buildRamGradient = (maxRam: number) => {
	const greenStartPercent = toRamPercent(2, maxRam);
	const yellowReturnPercent = toRamPercent(10, maxRam);
	const redReturnPercent = toRamPercent(16, maxRam);

	return `linear-gradient(90deg, #facc15 0%, #22c55e ${greenStartPercent}%, #22c55e ${yellowReturnPercent}%, #facc15 ${redReturnPercent}%, #ef4444 100%)`;
};

const snapRam = (gb: number, max: number) => {
	const stepped = Math.round(gb / RAM_MIN_GB) * RAM_MIN_GB;
	return Math.max(RAM_MIN_GB, Math.min(stepped, max));
};

const RamSliderField: React.FC<RamSliderFieldProps> = ({ id, value, onChange, className }) => {
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
	const clampedRam = Math.max(RAM_MIN_GB, Math.min(value, maxRam));
	const sliderPosition = Math.round(
		ramToSliderFraction(clampedRam, RAM_MIN_GB, maxRam) * SLIDER_RESOLUTION,
	);
	const proxyGradient = React.useMemo(() => buildRamGradient(maxRam), [maxRam]);
	const visibleRamMarkers = React.useMemo(
		() => ramMarkers.filter((marker) => marker >= RAM_MIN_GB && marker <= maxRam),
		[maxRam],
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
						Memory{' '}
						<TooltipTrigger>
							<Info className='size-4' />
						</TooltipTrigger>
					</Label>

					<TooltipContent className='text-center'>
						The more RAM the better up to a point.
						<br /> Diminishing returns usually start at 10GB.
						<br /> The max recommended is 16GB even for heavily modded servers.
						<br /> Too much can also cause system instability.
						<br /> (detected system memory: {systemMemoryLimitGb} GB).
					</TooltipContent>
				</Tooltip>
				<p className='text-sm font-medium text-muted-foreground'>{formatRamLabel(clampedRam)}</p>
			</div>
			<Slider
				id={id}
				value={[sliderPosition]}
				min={0}
				max={SLIDER_RESOLUTION}
				step={1}
				trackStyle={{ background: proxyGradient }}
				rangeClassName='bg-transparent'
				onValueChange={(nextValue) => {
					const position = nextValue[0] ?? 0;
					const ram = sliderFractionToRam(position / SLIDER_RESOLUTION, RAM_MIN_GB, maxRam);
					onChange(snapRam(ram, maxRam));
				}}
			/>
			<div className='relative h-1'>
				{visibleRamMarkers.map((marker) => (
					<div
						key={marker}
						className='absolute -top-[250%] -translate-x-1/2'
						style={{ left: `${toRamPercent(marker, maxRam)}%` }}>
						<span className='text-[12px] h-1 text-muted-foreground'>{formatHeapSize(marker)}</span>
					</div>
				))}
			</div>
			{clampedRam >= warningStartRam && (
				<p className='text-sm text-muted-foreground flex gap-2 items-center'>
					<CircleAlert className='size-4 shrink-0' />
					This much RAM may cause system instability.
				</p>
			)}
		</Field>
	);
};

export default React.memo(RamSliderField);
