import React from 'react';
import clsx from 'clsx';
import { Archive, Globe, Package, Plug, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ServerContentTab } from './server-types';

type ServerContentTabsProps = {
	activeTab: ServerContentTab;
	onTabChange: (tab: ServerContentTab) => void;
};

const tabMeta: Record<ServerContentTab, { icon: React.ReactNode; label: string }> = {
	plugins: { icon: <Plug />, label: 'Plugins' },
	worlds: { icon: <Globe />, label: 'Worlds' },
	datapacks: { icon: <Package />, label: 'Datapacks' },
	backups: { icon: <Archive />, label: 'Backups' },
	settings: { icon: <Settings />, label: 'Settings' },
};

const tabs: ServerContentTab[] = ['plugins', 'worlds', 'datapacks', 'backups', 'settings'];

const ServerContentTabs: React.FC<ServerContentTabsProps> = ({ activeTab, onTabChange }) => (
	<div className='mb-6  w-full flex'>
		{tabs.map((item) => (
			<Button
				key={item}
				className={clsx(
					'border-t-2 border-border hover:border-black hover:dark:border-white rounded-md rounded-t-none flex-1',
					activeTab === item && 'border-black dark:border-white',
				)}
				variant={activeTab === item ? 'secondary' : 'ghost'}
				onClick={() => onTabChange(item)}>
				<span className='flex items-center justify-center gap-2'>
					{tabMeta[item].icon}
					{tabMeta[item].label}
				</span>
			</Button>
		))}
	</div>
);

export default React.memo(ServerContentTabs);
