import React from 'react';
import { m } from 'motion/react';
import { useServers } from '../data/servers';
import { toast } from 'sonner';
import SettingsAppearanceCard from './settings/settings-appearance-card';
import SettingsDataCard from './settings/settings-data-card';
import SettingsUpdateCard from './settings/settings-update-card';
import { useAppUpdate } from './settings/hooks/use-app-update';

const Settings: React.FC = () => {
	const { resetServers } = useServers();
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

	const handleClearAllData = () => {
		resetServers();
		toast.success('All data has been cleared!');
	};

	return (
		<main className='min-h-[calc(100vh-40px)] px-12 py-18 w-full overflow-y-auto'>
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
						transition={{ type: 'spring', duration: 0.5, delay: 0.1, bounce: 0 }}>
						<SettingsDataCard onClearAllData={handleClearAllData} />
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
						/>
					</m.div>
				</div>
			</div>
		</main>
	);
};

export default Settings;
