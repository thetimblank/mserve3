import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import RamSliderField from '@/components/ram-slider-field';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUser } from '@/data/user';
import { isProxyProvider } from '@/lib/server-provider';
import { CheckCircle2 } from 'lucide-react';
import { Provider } from '@/lib/mserve-schema';
import { cn } from '@/lib/utils';

type RamPreset = {
	key: string;
	label: string;
	ram: number;
	description: string;
};

const PROXY_RAM_PRESETS: RamPreset[] = [
	{
		key: 'proxy-low',
		label: 'Low',
		ram: 0.5,
		description: 'Lean footprint for lightweight proxy routing.',
	},
	{
		key: 'proxy-medium',
		label: 'Medium',
		ram: 1,
		description: 'Lean footprint for lightweight proxy routing.',
	},
	{
		key: 'proxy-high',
		label: 'High',
		ram: 2,
		description: 'Extra headroom for busier proxy networks.',
	},
];

const GAMEPLAY_RAM_PRESETS: RamPreset[] = [
	{
		key: 'low',
		label: 'Low',
		ram: 2,
		description: '1-5 Players. Small & private community. Little plugins.',
	},
	{
		key: 'decent',
		label: 'Decent',
		ram: 3,
		description: '3-10 Players. Small community. Normal plugin amount.',
	},
	{
		key: 'medium',
		label: 'Medium',
		ram: 4,
		description: '5-30 Players. Medium community. Recommended for most servers.',
	},
	{
		key: 'high',
		label: 'High',
		ram: 6,
		description: '30-60 Players. Lots of plugins. Medium/Large community. Large map.',
	},
	{
		key: 'performance',
		label: 'Performance',
		ram: 10,
		description: '60+ players. Large community. Lots of plugins. Large map.',
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
		updateField('ram', visiblePresets[0].ram);
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
											{selected ? (
												<div className='flex items-center gap-1.5'>
													<CheckCircle2 className='size-4' />
													<span>{preset.label}</span>
												</div>
											) : (
												<span>{preset.label}</span>
											)}
											<span className='text-sm text-muted-foreground'>{preset.ram} GB</span>
										</CardTitle>
										<CardDescription>{preset.description}</CardDescription>
									</CardHeader>
								</Card>
							</button>
						);
					})}
					<p className='text-xs text-muted-foreground'>Detected {systemMemoryGb} GB</p>
				</div>
			)}
		</>
	);
}
