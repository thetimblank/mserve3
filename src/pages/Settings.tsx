import React from 'react';
import { isStoppedStatus, useServers } from '../data/servers';
import { useNetworks } from '../data/networks';
import { useUser } from '../data/user';
import { useTheme } from '@/components/theme-provider';
import { HelpButton } from '@/components/help/help-button';
import { type SettingsGroup, type SettingsSection, SettingsLayout } from '@/components/settings/settings-layout';
import { clearAppStorage } from '@/lib/local-storage';
import { toast } from 'sonner';
import SettingsAppearanceSection from './settings/settings-appearance-section';
import SettingsBehaviorSection from './settings/settings-behavior-section';
import SettingsTunnelSection from './settings/settings-tunnel-section';
import SettingsJavaSection from './settings/settings-java-section';
import SettingsServerPageSection from './settings/settings-server-page-section';
import SettingsDataSection from './settings/settings-data-section';
import SettingsUpdateSection from './settings/settings-update-section';
import { useAppUpdate } from './settings/hooks/use-app-update';

const SETTINGS_GROUPS: SettingsGroup[] = [
	{ id: 'app', title: 'App' },
	{ id: 'servers', title: 'Servers' },
	{ id: 'data', title: 'Data' },
];

const Settings: React.FC = () => {
	const { servers, resetServers } = useServers();
	const { networks, removeNetwork } = useNetworks();
	const { resetUser } = useUser();
	const { setTheme } = useTheme();
	const {
		currentVersion,
		isVersionReady,
		isCheckingUpdate,
		isInstallingUpdate,
		availableUpdate,
		updateMessage,
		errorMessage,
		checkForUpdates,
		installUpdate,
	} = useAppUpdate();

	// A running server would keep running with no way left to stop it.
	const hasRunningServers = servers.some((server) => !isStoppedStatus(server.status));
	// Installing an update closes mserve, which takes live server processes with it.
	const liveServerNames = servers
		.filter((server) => !isStoppedStatus(server.status) && server.status !== 'sleeping')
		.map((server) => server.name);

	const handleClearAllData = () => {
		if (hasRunningServers) {
			toast.error('Stop every server before clearing all data.');
			return;
		}
		// Storage first: the resets below then persist their defaults.
		clearAppStorage();
		resetServers();
		for (const network of networks) removeNetwork(network.id);
		resetUser();
		setTheme('dark');
		toast.success('All data has been cleared!');
	};

	const sections: SettingsSection[] = [
		{
			id: 'appearance',
			group: 'app',
			title: 'Appearance',
			description: 'Customize how the app looks.',
			keywords: ['theme', 'dark', 'light', 'mode', 'color', 'dashboard', 'background', 'veil'],
			render: () => <SettingsAppearanceSection />,
		},
		{
			id: 'behavior',
			group: 'app',
			title: 'Behavior & experience',
			description: 'Your experience level and how the app behaves in certain situations.',
			keywords: [
				'experience',
				'level',
				'beginner',
				'standard',
				'advanced',
				'close',
				'quit',
				'warning',
				'update checks',
				'startup',
				'welcome',
				'tour',
				'onboarding',
			],
			render: () => <SettingsBehaviorSection />,
		},
		{
			id: 'updates',
			group: 'app',
			title: 'Updates',
			description: 'Check for and install over-the-air updates of mserve.',
			keywords: ['update', 'version', 'upgrade', 'install', 'release'],
			render: () => (
				<SettingsUpdateSection
					currentVersion={currentVersion}
					isVersionReady={isVersionReady}
					updateMessage={updateMessage}
					errorMessage={errorMessage}
					isCheckingUpdate={isCheckingUpdate}
					isInstallingUpdate={isInstallingUpdate}
					availableUpdateVersion={availableUpdate?.version ?? null}
					onCheckForUpdates={checkForUpdates}
					onInstallUpdate={installUpdate}
					liveServerNames={liveServerNames}
				/>
			),
		},
		{
			id: 'server-page',
			group: 'servers',
			title: 'Server page display',
			description: "What a server's overview shows besides its status, controls, and address.",
			keywords: [
				'overview',
				'stats',
				'metrics',
				'live',
				'details',
				'cpu',
				'ram',
				'players',
				'tps',
				'uptime',
				'display',
			],
			render: () => <SettingsServerPageSection />,
		},
		{
			id: 'java',
			group: 'servers',
			title: 'Java defaults',
			titleAddon: <HelpButton topic='java' />,
			description:
				'Choose the Java used when a server is set to Automatic. Leave on Automatic to let each server pick the version that matches its Minecraft version.',
			keywords: ['java', 'jdk', 'runtime', 'default', 'installation', 'path', 'rescan'],
			render: () => <SettingsJavaSection />,
		},
		{
			id: 'tunnel',
			group: 'servers',
			title: 'Tunnel',
			titleAddon: <HelpButton topic='tunneling' />,
			description:
				'Connect a free playit.gg account to make your servers reachable over the internet without port forwarding.',
			keywords: ['tunnel', 'playit', 'account', 'connect', 'disconnect', 'public', 'internet', 'port forward'],
			render: () => <SettingsTunnelSection />,
		},
		{
			id: 'data',
			group: 'data',
			title: 'Data & storage',
			description: 'Where your servers live and the data mserve stores.',
			keywords: ['data', 'storage', 'privacy', 'root', 'path', 'folder', 'directory', 'clear', 'reset'],
			render: () => (
				<SettingsDataSection onClearAllData={handleClearAllData} canClearAllData={!hasRunningServers} />
			),
		},
	];

	return (
		<main className='h-full w-full px-12 pt-18'>
			<SettingsLayout groups={SETTINGS_GROUPS} sections={sections} />
		</main>
	);
};

export default Settings;
