import * as React from 'react';
import RamSliderField from '@/components/ram-slider-field';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useExperience } from '@/data/user';
import { useAutoRamPlan } from '@/hooks/use-auto-ram-plan';
import { useSystemMemoryGb } from '@/hooks/use-system-memory';
import { isProxyProvider } from '@/lib/server-provider';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import type { Provider, RamMode } from '@/lib/mserve-schema';
import { formatRamLabel } from '@/lib/ram-utils';
import { cn } from '@/lib/utils';

type RamPreset = {
	key: string;
	label: string;
	ram: number;
	description: string;
	/** The preset a beginner's custom value snaps to in the wizard (manual mode). */
	fallback?: boolean;
};

const PROXY_RAM_PRESETS: RamPreset[] = [
	{
		key: 'proxy-low',
		label: 'Low',
		ram: 0.5,
		description: '512 MB. Tiny networks routing a handful of players.',
	},
	{
		key: 'proxy-medium',
		label: 'Medium',
		ram: 1,
		fallback: true,
		description: '1 GB. Comfortable headroom for most proxy networks.',
	},
	{
		key: 'proxy-high',
		label: 'High',
		ram: 2,
		description: '2 GB. Extra capacity for large or busy networks.',
	},
];

const GAMEPLAY_RAM_PRESETS: RamPreset[] = [
	{
		key: 'low',
		label: 'Low',
		ram: 2,
		description: '2 GB. 1-5 players on vanilla or a few light plugins.',
	},
	{
		key: 'decent',
		label: 'Decent',
		ram: 3,
		description: '3 GB. 5-10 players with a modest plugin set.',
	},
	{
		key: 'medium',
		label: 'Medium',
		ram: 4,
		fallback: true,
		description: '4 GB. 10-30 players. A safe pick for most servers.',
	},
	{
		key: 'high',
		label: 'High',
		ram: 6,
		description: '6 GB. 30-60 players with many plugins or a large world.',
	},
	{
		key: 'performance',
		label: 'Performance',
		ram: 10,
		description: '10 GB. 60+ players, heavy plugins and large worlds.',
	},
];

const SELECTED_CARD = 'border-accent bg-accent/50 dark:bg-accent/50';

/** Called like overloads, so a form's generic `updateField` fits as-is. */
type UpdateRamField = ((key: 'ram', value: number) => void) & ((key: 'ram_mode', value: RamMode) => void);

interface Props extends React.HTMLAttributes<HTMLDivElement> {
	updateField: UpdateRamField;
	// Optional: modpack servers have no jar-based provider yet, so fall back to the
	// gameplay presets (a modpack is never a proxy).
	provider?: Provider | null;
	ram: number;
	ramMode: RamMode;
	/** The server folder, so the Auto card can size from its plugins/mods. Omit in the wizard. */
	directory?: string;
	/** The wizard is creating a modpack server (sizes Auto like one). */
	modpack?: boolean;
	/**
	 * Replace a manual value that isn't one of the presets with the fallback one.
	 * Only for picking a fresh default (the create wizard): an existing server
	 * keeps its RAM and shows it as a "Current" card instead.
	 */
	snapToPreset?: boolean;
}

export default function RamSelector({
	provider,
	ram,
	ramMode,
	directory,
	modpack = false,
	className,
	updateField,
	snapToPreset,
	...props
}: Props) {
	const { atLeast } = useExperience();
	const systemMemoryGb = useSystemMemoryGb();
	const isAuto = ramMode === 'auto';
	const plan = useAutoRamPlan({ directory, provider: provider?.name, modpack });

	const showSlider = atLeast('standard');
	const basePresets = React.useMemo(
		() => (isProxyProvider(provider) ? PROXY_RAM_PRESETS : GAMEPLAY_RAM_PRESETS),
		[provider],
	);
	const visiblePresets = React.useMemo(() => {
		if (systemMemoryGb === null) return basePresets;
		const maxBasicRam = Math.max(1, systemMemoryGb - 2);
		return basePresets.filter((preset) => preset.ram <= maxBasicRam);
	}, [basePresets, systemMemoryGb]);
	const isPresetValue = visiblePresets.some((preset) => preset.ram === ram);

	React.useEffect(() => {
		if (!snapToPreset || isAuto || showSlider || systemMemoryGb === null) return;
		if (visiblePresets.length === 0 || isPresetValue) return;
		const fallback = visiblePresets.find((preset) => preset.fallback) ?? visiblePresets[visiblePresets.length - 1];
		updateField('ram', fallback.ram);
	}, [isAuto, showSlider, isPresetValue, snapToPreset, systemMemoryGb, updateField, visiblePresets]);

	const pickManual = (value: number) => {
		updateField('ram', value);
		updateField('ram_mode', 'manual');
	};

	return (
		<div className={cn('flex flex-col gap-2', className)} {...props}>
			<button type='button' onClick={() => updateField('ram_mode', 'auto')} className='text-left cursor-pointer'>
				<Card className={isAuto ? SELECTED_CARD : ''}>
					<CardHeader>
						<CardTitle className='flex items-center justify-between'>
							<div className='flex items-center gap-1.5'>
								{isAuto && <CheckCircle2 className='size-4' />}
								<span>Auto</span>
								<span className='rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground'>
									Recommended
								</span>
							</div>
							<span className='text-sm text-muted-foreground'>
								{plan ? `Up to ${formatRamLabel(plan.capGb)}` : 'Up to –'}
							</span>
						</CardTitle>
						<CardDescription>
							Sized from the server type, its plugins or mods and player slots. Starts small, grows
							when needed and leaves room for your PC and other running servers.
						</CardDescription>
						{plan?.exceedsSystemCap && (
							<p className='flex items-center gap-2 text-sm text-muted-foreground'>
								<CircleAlert className='size-4 shrink-0' />
								This server would like {formatRamLabel(plan.estimateGb)}, but this PC can only spare{' '}
								{formatRamLabel(plan.capGb)} right now.
							</p>
						)}
					</CardHeader>
				</Card>
			</button>
			{!isAuto && !isPresetValue && !snapToPreset && !showSlider && (
				<Card className={SELECTED_CARD}>
					<CardHeader>
						<CardTitle className='flex items-center justify-between'>
							<div className='flex items-center gap-1.5'>
								<CheckCircle2 className='size-4' />
								<span>Current</span>
							</div>
							<span className='text-sm text-muted-foreground'>{formatRamLabel(ram)}</span>
						</CardTitle>
						<CardDescription>A custom amount. Pick Auto or a preset to change it.</CardDescription>
					</CardHeader>
				</Card>
			)}
			{visiblePresets.map((preset) => {
				const selected = !isAuto && ram === preset.ram;
				return (
					<button
						key={preset.key}
						type='button'
						onClick={() => pickManual(preset.ram)}
						className='text-left cursor-pointer'>
						<Card className={selected ? SELECTED_CARD : ''}>
							<CardHeader>
								<CardTitle className='flex items-center justify-between'>
									<div className='flex items-center gap-1.5'>
										{selected && <CheckCircle2 className='size-4' />}
										<span>{preset.label}</span>
									</div>
									<span className='text-sm text-muted-foreground'>{formatRamLabel(preset.ram)}</span>
								</CardTitle>
								<CardDescription>{preset.description}</CardDescription>
							</CardHeader>
						</Card>
					</button>
				);
			})}
			{showSlider && (
				<RamSliderField
					id='create-server-ram'
					label='Custom amount'
					className={cn('pt-2', isAuto && 'opacity-60')}
					value={ram}
					onChange={(value) => updateField('ram', value)}
					onUserChange={() => updateField('ram_mode', 'manual')}
				/>
			)}
		</div>
	);
}
