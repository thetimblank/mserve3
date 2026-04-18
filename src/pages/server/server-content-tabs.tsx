import React from 'react';
import clsx from 'clsx';
import { Archive, Globe, Package, Plug, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ServerContentTab } from './server-types';

type ServerContentTabsProps = {
	activeTab: ServerContentTab;
	onTabChange: (tab: ServerContentTab) => void;
	availableTabs?: ServerContentTab[];
};

const tabMeta: Record<ServerContentTab, { icon: React.ReactNode; label: string }> = {
	plugins: { icon: <Plug />, label: 'Plugins' },
	worlds: { icon: <Globe />, label: 'Worlds' },
	datapacks: { icon: <Package />, label: 'Datapacks' },
	backups: { icon: <Archive />, label: 'Backups' },
	settings: { icon: <Settings />, label: 'Settings' },
};

const defaultTabs: ServerContentTab[] = ['plugins', 'worlds', 'datapacks', 'backups', 'settings'];

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
		<>
			{availableTabs.map((item) => (
				<Button
					key={item}
					className={clsx(
						'flex-1',
						activeTab === item && 'bg-accent text-accent-foreground hover:bg-accent cursor-default',
					)}
					variant='secondary'
					onClick={() => handleTabClick(item)}>
					<span className='flex items-center justify-center gap-2'>
						{tabMeta[item].icon}
						{tabMeta[item].label}
					</span>
				</Button>
			))}
		</>
	);
};

export default React.memo(ServerContentTabs);
