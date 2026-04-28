import React from 'react';
import clsx from 'clsx';
import { Archive, Globe, Home, Package, Plug, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { ServerContentTab } from './server-types';

type ServerContentTabsProps = {
	activeTab: ServerContentTab;
	serverId: string;
	availableTabs?: ServerContentTab[];
};

const tabMeta: Record<ServerContentTab, { icon: React.ReactNode; label: string }> = {
	overview: { icon: <Home />, label: 'Overview' },
	plugins: { icon: <Plug />, label: 'Plugins' },
	worlds: { icon: <Globe />, label: 'Worlds' },
	datapacks: { icon: <Package />, label: 'Datapacks' },
	backups: { icon: <Archive />, label: 'Backups' },
	settings: { icon: <Settings />, label: 'Settings' },
};

export const SERVER_TABS: ServerContentTab[] = [
	'overview',
	'settings',
	'plugins',
	'worlds',
	'datapacks',
	'backups',
];

export const isServerContentTab = (value: string | undefined): value is ServerContentTab =>
	value !== undefined && SERVER_TABS.includes(value as ServerContentTab);

export const getServerContentTabUrl = (serverId: string, tab: ServerContentTab) =>
	`/servers/${encodeURIComponent(serverId)}/${tab}`;

export const getAvailableServerContentTabs = (providerKind?: string | null): ServerContentTab[] => {
	const tabs: ServerContentTab[] = ['overview', 'settings'];

	if (providerKind !== 'vanilla') {
		tabs.push('plugins');
	}

	if (providerKind !== 'proxy') {
		tabs.splice(tabs.length, 0, 'worlds', 'datapacks', 'backups');
	}

	return tabs;
};

const ServerContentTabs: React.FC<ServerContentTabsProps> = ({
	activeTab,
	serverId,
	availableTabs = SERVER_TABS,
}) => {
	return (
		<div className='flex gap-2 w-full border-b-2'>
			{availableTabs.map((item) => (
				<Button
					key={item}
					className={clsx(
						'rounded-b-none border-b-2 -mb-0.5',
						activeTab === item
							? 'bg-accent/75 border-b-accent text-accent-foreground hover:bg-accent/75 cursor-default'
							: 'border-transparent bg-transparent hover:border-border',
					)}
					variant='secondary'
					asChild>
					<Link
						aria-current={activeTab === item ? 'page' : undefined}
						to={getServerContentTabUrl(serverId, item)}>
						<span className='flex items-center justify-center gap-2'>
							{tabMeta[item].icon}
							{tabMeta[item].label}
						</span>
					</Link>
				</Button>
			))}
		</div>
	);
};

export default React.memo(ServerContentTabs);
