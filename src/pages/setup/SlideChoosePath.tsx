import * as React from 'react';
import { Check, House, Minus, Router, Waypoints, type LucideIcon } from 'lucide-react';

import { SlideFrame } from '@/components/slideshow';
import { Button } from '@/components/ui/button';
import { useLocalIp } from '@/hooks/use-ip-address';
import { cn } from '@/lib/utils';
import { useSetup } from './SetupContext';
import type { HostingPath } from './setup-steps';

type PathOption = {
	path: HostingPath;
	icon: LucideIcon;
	title: string;
	summary: string;
	tag?: string;
	pros: string[];
	cons: string[];
	action: string;
};

export const HOSTING_PATH_OPTIONS: readonly PathOption[] = [
	{
		path: 'tunnel',
		icon: Waypoints,
		title: 'Tunnel',
		summary: 'playit.gg gives your server a public address. Players connect to playit, which passes them on to you.',
		tag: 'Easiest',
		pros: [
			'No router access needed',
			'Works where forwarding is blocked (CGNAT, dorms, apartments)',
			'Hides your home IP',
			'Address stays the same if your home IP changes',
			'Quick setup',
		],
		cons: [
			'A bit more ping: traffic detours through the nearest playit location',
			'Depends on playit.gg being up and on your playit account',
			'Free addresses are generated (custom domains are paid)',
			"Players show up with a local address instead of their own, so IP bans don't work (ban by name)",
		],
		action: 'Use a tunnel',
	},
	{
		path: 'forward',
		icon: Router,
		title: 'Port forwarding',
		summary: 'Your router sends players straight to this PC. The classic way to host.',
		pros: ['Direct connection, lowest ping', 'No third party or account', 'Free, with no limits'],
		cons: [
			'Needs admin access to your router, and the steps differ per router',
			'Impossible behind CGNAT',
			'Shares your home IP (rough location, a target for DDoS attacks)',
			'Home IPs can change and break the address (a dynamic DNS name fixes this)',
			'Opens a port on your network (only the server listens on it)',
		],
		action: 'Port forward',
	},
];

const ProsCons: React.FC<{ title: string; items: string[]; icon: LucideIcon; iconClassName: string }> = ({
	title,
	items,
	icon: Icon,
	iconClassName,
}) => (
	<div className='space-y-1.5'>
		<p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{title}</p>
		<ul className='space-y-1.5 text-sm'>
			{items.map((item) => (
				<li key={item} className='flex gap-2'>
					<Icon className={cn('mt-0.5 size-4 shrink-0', iconClassName)} />
					<span>{item}</span>
				</li>
			))}
		</ul>
	</div>
);

export default function SlideChoosePath() {
	const { choosePath } = useSetup();
	const localIp = useLocalIp();

	return (
		<SlideFrame className='flex w-full max-w-4xl flex-col items-center text-center'>
			<h1 className='mb-2 text-3xl font-bold'>How will friends join?</h1>
			<p className='mb-6 text-muted-foreground'>Pick one. You can switch later.</p>

			<div className='mb-8 flex items-center gap-2 rounded-xl bg-secondary/50 px-4 py-2 text-left text-sm'>
				<House className='size-4 shrink-0 text-muted-foreground' />
				<p>
					Same Wi-Fi or home network? You need neither: they join with this PC&apos;s local IP
					{typeof localIp === 'string' && (
						<>
							{' '}
							<span className='font-mono font-semibold'>{localIp}</span>
						</>
					)}
					.
				</p>
			</div>

			<div className='grid w-full gap-4 text-left md:grid-cols-2'>
				{HOSTING_PATH_OPTIONS.map((option) => (
					<div key={option.path} className='flex flex-col gap-4 rounded-2xl bg-secondary/50 p-5'>
						<div className='flex items-start gap-3'>
							<option.icon className='mt-1 size-6 shrink-0' />
							<div className='space-y-1'>
								<div className='flex items-center gap-2'>
									<h2 className='text-xl font-bold'>{option.title}</h2>
									{option.tag && (
										<span className='rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>
											{option.tag}
										</span>
									)}
								</div>
								<p className='text-sm text-muted-foreground'>{option.summary}</p>
							</div>
						</div>
						<ProsCons title='Pros' items={option.pros} icon={Check} iconClassName='text-emerald-500' />
						<ProsCons title='Cons' items={option.cons} icon={Minus} iconClassName='text-muted-foreground' />
						<Button className='mt-auto' onClick={() => choosePath(option.path)}>
							{option.action}
						</Button>
					</div>
				))}
			</div>
		</SlideFrame>
	);
}
