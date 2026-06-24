import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import RamSliderField from '@/components/ram-slider-field';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUser } from '@/data/user';
import { isProxyProvider } from '@/lib/server-provider';
import { CheckCircle2 } from 'lucide-react';
import { Provider } from '@/lib/mserve-schema';
import { formatRamLabel } from '@/lib/ram-utils';
import { cn } from '@/lib/utils';

type RamPreset = {
	key: string;
	label: string;
	ram: number;
	description: string;
	recommended?: boolean;
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
		recommended: true,
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
		recommended: true,
		description: '4 GB. 10-30 players. Recommended for most servers.',
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

interface Props extends React.HTMLAttributes<HTMLDivElement> {
	updateField: (key: 'ram', value: number) => void;
	provider: Provider;
	ram: number;
}

export default function RamSelector({ provider, ram, className, updateField, ...props }: Props) {
	const { user } = useUser();
	const [systemMemoryGb, setSystemMemoryGb] = React.useState(16);

	React.useEffect(() => {
		let active = true;
		void invoke<number>('get_system_memory_gb')
			.then((memoryGb) => {
				if (!active) return;
				const parsed = Number(memoryGb);
				if (!Number.isFinite(parsed) || parsed < 1) return;
				setSystemMemoryGb(Math.ceil(parsed));
			})
			.catch(() => {
				if (!active) return;
				setSystemMemoryGb(16);
			});

		return () => {
			active = false;
		};
	}, []);

	const maxBasicRam = Math.max(1, systemMemoryGb - 2);
	const isAdvancedMode = user.advanced_mode;
	const basePresets = React.useMemo(
		() => (isProxyProvider(provider) ? PROXY_RAM_PRESETS : GAMEPLAY_RAM_PRESETS),
		[provider],
	);
	const visiblePresets = React.useMemo(
		() => basePresets.filter((preset) => preset.ram <= maxBasicRam),
		[basePresets, maxBasicRam],
	);

	React.useEffect(() => {
		if (isAdvancedMode) return;
		if (visiblePresets.length === 0) return;
		if (visiblePresets.some((preset) => preset.ram === ram)) return;
		const recommended =
			visiblePresets.find((preset) => preset.recommended) ?? visiblePresets[visiblePresets.length - 1];
		updateField('ram', recommended.ram);
	}, [ram, isAdvancedMode, updateField, visiblePresets]);

	return (
		<>
			{isAdvancedMode ? (
				<RamSliderField
					id='create-server-ram'
					value={ram}
					onChange={(value) => updateField('ram', value)}
				/>
			) : (
				<div className={cn('flex flex-col gap-2', className)} {...props}>
					{visiblePresets.map((preset) => {
						const selected = ram === preset.ram;
						return (
							<button
								key={preset.key}
								type='button'
								onClick={() => updateField('ram', preset.ram)}
								className='text-left cursor-pointer'>
								<Card className={selected ? 'border-accent bg-accent/50 dark:bg-accent/50' : ''}>
									<CardHeader>
										<CardTitle className='flex items-center justify-between'>
											<div className='flex items-center gap-1.5'>
												{selected && <CheckCircle2 className='size-4' />}
												<span>{preset.label}</span>
												{preset.recommended && (
													<span className='rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground'>
														Recommended
													</span>
												)}
											</div>
											<span className='text-sm text-muted-foreground'>
												{formatRamLabel(preset.ram)}
											</span>
										</CardTitle>
										<CardDescription>{preset.description}</CardDescription>
									</CardHeader>
								</Card>
							</button>
						);
					})}
				</div>
			)}
		</>
	);
}
