import React from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/button';
import type { ServerContentTab } from './server-types';

type ServerContentTabsProps = {
	serverStatus: 'online' | 'offline' | 'starting' | 'closing';
	activeTab: ServerContentTab;
	onTabChange: (tab: ServerContentTab) => void;
};

const tabs: ServerContentTab[] = ['plugins', 'worlds', 'datapacks', 'backups'];

const ServerContentTabs: React.FC<ServerContentTabsProps> = ({ serverStatus, activeTab, onTabChange }) => (
	<div className='mb-6  w-full flex'>
		{tabs.map((item) => (
			<Button
				key={item}
				className={clsx(
					'border-t-2 border-border rounded-md rounded-t-none flex-1 capitalize',
					serverStatus === 'online' && 'border-green-500',
					serverStatus === 'offline' && 'border-red-400',
					(serverStatus === 'starting' || serverStatus === 'closing') && 'border-yellow-500',
					activeTab === item && 'border-black dark:border-white',
				)}
				variant={activeTab === item ? 'secondary' : 'ghost'}
				onClick={() => onTabChange(item)}>
				{item}
			</Button>
		))}
	</div>
);

export default React.memo(ServerContentTabs);
