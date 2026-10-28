import React from 'react';
import { m } from 'motion/react';
import { isStoppedStatus, useServers } from '../data/servers';
import { useNetworks } from '../data/networks';
import { useUser } from '../data/user';
import { useTheme } from '@/components/theme-provider';
import { clearAppStorage } from '@/lib/local-storage';
import { toast } from 'sonner';
import SettingsAppearanceCard from './settings/settings-appearance-card';
import SettingsBehaviorCard from './settings/settings-behavior-card';
import SettingsTunnelCard from './settings/settings-tunnel-card';
import SettingsJavaCard from './settings/settings-java-card';
import SettingsDataCard from './settings/settings-data-card';
import SettingsUpdateCard from './settings/settings-update-card';
import { useAppUpdate } from './settings/hooks/use-app-update';

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

	return (
		<main className='h-full px-12 py-18 w-full overflow-y-auto app-scroll-area'>
			<div className='flex flex-col'>
				<m.h1
					initial={{ y: 50, opacity: 0 }}
					whileInView={{ y: 0, opacity: 1 }}
					transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
					className='text-3xl flex gap-5 items-center font-black mb-4 w-fit'>
					Settings
				</m.h1>

				<div className='space-y-6'>
					<m.div
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, bounce: 0 }}>
						<SettingsAppearanceCard />
					</m.div>

					<m.div
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, delay: 0.05, bounce: 0 }}>
						<SettingsBehaviorCard />
					</m.div>

					<m.div
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, delay: 0.1, bounce: 0 }}>
						<SettingsJavaCard />
					</m.div>

					<m.div
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, delay: 0.125, bounce: 0 }}>
						<SettingsTunnelCard />
					</m.div>

					<m.div
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, delay: 0.15, bounce: 0 }}>
						<SettingsDataCard onClearAllData={handleClearAllData} canClearAllData={!hasRunningServers} />
					</m.div>

					<m.div
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, bounce: 0 }}>
						<SettingsUpdateCard
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
					</m.div>
				</div>
			</div>
		</main>
	);
};

export default Settings;
