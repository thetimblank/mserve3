import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Server } from '@/data/servers';
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';
import { getAvailableServerContentTabs, getServerContentTabUrl } from '../server-content-tabs';

type Group = { icon: React.ElementType; title: string; bullets: string[] };

const GROUPS: Group[] = [
	{
		icon: ShieldCheck,
		title: 'Anti-cheat',
		bullets: [
			'Spots hacked clients (flying, speed, reach)',
			'Warns staff, kicks, or bans cheaters',
			'Most useful on public survival and PvP servers',
		],
	},
	{
		icon: Bot,
		title: 'Anti-bot',
		bullets: [
			'Stops floods of fake players joining at once',
			'Checks new players before letting them in',
			'Keeps the server responsive during an attack',
		],
	},
	{
		icon: KeyRound,
		title: 'Other security',
		bullets: [
			'Permissions: choose who can use which commands',
			'Login protection: passwords or 2FA for staff',
			'Block logging: see who broke what and roll it back',
		],
	},
];

/**
 * What kinds of plugins (or mods) harden a server, with a way to the tab that
 * installs them. Deliberately names no specific project: those go stale.
 */
const SecurityPluginGuide: React.FC<{ server: Server }> = ({ server }) => {
	const tabs = getAvailableServerContentTabs(getServerProviderCapabilities(server.provider).kind);
	const tab = tabs.includes('plugins') ? 'plugins' : tabs.includes('mods') ? 'mods' : null;
	// Vanilla loads neither plugins nor mods, so there is nothing to suggest.
	if (!tab) return null;

	return (
		<section aria-labelledby='security-plugin-guide-title' className='space-y-4'>
			<div className='space-y-1'>
				<h3 id='security-plugin-guide-title' className='text-base font-semibold'>
					Protect your server with {tab}
				</h3>
				<p className='text-sm text-muted-foreground'>
					Settings only go so far. These kinds of {tab} add protection on top.
				</p>
			</div>

			<div className='grid gap-6 @md:grid-cols-3'>
				{GROUPS.map(({ icon: Icon, title, bullets }) => (
					<div key={title} className='space-y-2'>
						<div className='flex items-center gap-2'>
							<Icon className='size-5 shrink-0 text-muted-foreground' aria-hidden />
							<p className='font-medium'>{title}</p>
						</div>
						<ul className='list-disc space-y-1 pl-5 text-sm text-muted-foreground'>
							{bullets.map((bullet) => (
								<li key={bullet}>{bullet}</li>
							))}
						</ul>
					</div>
				))}
			</div>

			<Button asChild variant='secondary'>
				<Link to={getServerContentTabUrl(server.id, tab)}>
					Browse {tab} <ArrowRight />
				</Link>
			</Button>
		</section>
	);
};

export default SecurityPluginGuide;
