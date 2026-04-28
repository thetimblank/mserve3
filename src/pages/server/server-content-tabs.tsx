import React from 'react';
import clsx from 'clsx';
import { Archive, Globe, Home, Package, Plug, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ServerContentTab } from './server-types';

type ServerContentTabsProps = {
	activeTab: ServerContentTab;
	onTabChange: (tab: ServerContentTab) => void;
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

const defaultTabs: ServerContentTab[] = ['overview', 'settings', 'plugins', 'worlds', 'datapacks', 'backups'];

const ServerContentTabs: React.FC<ServerContentTabsProps> = ({
	activeTab,
	onTabChange,
	availableTabs = defaultTabs,
}) => {
	const handleTabClick = React.useCallback(
		(tab: ServerContentTab) => {
			if (tab === activeTab) return;
			onTabChange(tab);
		},
		[activeTab, onTabChange],
	);

	return (
		<div className='flex gap-4 w-full'>
			{availableTabs.map((item) => (
				<Button
					key={item}
					className={clsx(
						'flex-1 rounded-b-none border-b-2 -mb-0.5',
						activeTab === item
							? 'bg-accent/75 border-b-accent text-accent-foreground hover:bg-accent/75 cursor-default'
							: 'border-transparent hover:border-border',
					)}
					variant='secondary'
					onClick={() => handleTabClick(item)}>
					<span className='flex items-center justify-center gap-2'>
						{tabMeta[item].icon}
						{tabMeta[item].label}
					</span>
				</Button>
			))}
		</div>
	);
};

export default React.memo(ServerContentTabs);
