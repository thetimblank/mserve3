import React from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { m } from 'motion/react';
import { ModeToggle } from '../components/mode-toggle';
import { Download, Palette, Trash } from 'lucide-react';
import { useServers } from '../data/servers';
import { isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

const Settings: React.FC = () => {
	const [currentVersion, setCurrentVersion] = React.useState('unknown');
	const [isCheckingUpdate, setIsCheckingUpdate] = React.useState(false);
	const [isInstallingUpdate, setIsInstallingUpdate] = React.useState(false);
	const [availableUpdate, setAvailableUpdate] = React.useState<Update | null>(null);
	const [updateMessage, setUpdateMessage] = React.useState('Not checked yet.');
	const { resetServers } = useServers();

	React.useEffect(() => {
		if (!isTauri()) {
			setUpdateMessage('Updater is available in desktop app builds only.');
			return;
		}

		let mounted = true;
		getVersion()
			.then((version) => {
				if (mounted) {
					setCurrentVersion(version);
				}
			})
			.catch(() => {
				setCurrentVersion('unknown');
			});

		return () => {
			mounted = false;
		};
	}, []);

	const handleClearAllData = () => {
		resetServers();
		toast.success('All data has been cleared!');
	};

	const handleCheckForUpdates = async () => {
		if (!isTauri()) {
			toast.error('Updater is only available in desktop app builds.');
			return;
		}

		setIsCheckingUpdate(true);
		try {
			const update = await check();
			if (!update) {
				setAvailableUpdate(null);
				setUpdateMessage('You are on the latest version.');
				toast.success('You are on the latest version.');
				return;
			}

			setAvailableUpdate(update);
			setUpdateMessage(`Update ${update.version} is available.`);
			toast.info(`Update ${update.version} is available.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to check for updates.';
			setUpdateMessage(message);
			toast.error(message);
		} finally {
			setIsCheckingUpdate(false);
		}
	};

	const handleInstallUpdate = async () => {
		if (!availableUpdate) {
			return;
		}

		setIsInstallingUpdate(true);
		try {
			await availableUpdate.downloadAndInstall();
			setAvailableUpdate(null);
			setUpdateMessage('Update installed. Restart MSERVE to finish updating.');
			toast.success('Update installed. Restart MSERVE to finish updating.');
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to install update.';
			setUpdateMessage(message);
			toast.error(message);
		} finally {
			setIsInstallingUpdate(false);
		}
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
					{/* Theme Settings */}
					<m.div
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, bounce: 0 }}>
						<Card>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<Palette className='w-5 h-5' />
									Appearance
								</CardTitle>
								<CardDescription>Customize how the app looks</CardDescription>
							</CardHeader>
							<CardContent className='space-y-4'>
								<div className='flex items-center gap-4'>
									<ModeToggle />
									<div>
										<p className='font-medium'>Theme</p>
										<p className='text-sm text-muted-foreground'>
											Choose between light and dark mode
										</p>
									</div>
								</div>
							</CardContent>
						</Card>
					</m.div>

					{/* Data & Privacy */}
					<m.div
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, delay: 0.1, bounce: 0 }}>
						<Card>
							<CardHeader>
								<CardTitle>Data & Privacy</CardTitle>
								<CardDescription>Manage your data</CardDescription>
							</CardHeader>
							<CardContent className='space-y-3'>
								{/* <Button variant='outline' className='w-full justify-start'>
									Export Data
								</Button>
								<Button variant='outline' className='w-full justify-start'>
									Import Data
								</Button> */}
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<Button variant='destructive-secondary'>
											<Trash />
											Clear All Data
										</Button>
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>Are you sure?</AlertDialogTitle>
											<AlertDialogDescription>
												This will remove all servers and restore defaults forever.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Cancel</AlertDialogCancel>
											<AlertDialogAction
												variant='destructive'
												className='capitalize'
												onClick={handleClearAllData}>
												Clear All Data
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							</CardContent>
						</Card>
					</m.div>

					<m.div
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, bounce: 0 }}>
						<Card>
							<CardHeader>
								<CardTitle>Updates</CardTitle>
								<CardDescription>Check and install over-the-air updates.</CardDescription>
							</CardHeader>
							<CardContent className='space-y-4'>
								<div>
									<p className='font-medium'>Current version: {currentVersion}</p>
									<p className='text-sm text-muted-foreground'>{updateMessage}</p>
								</div>
								<div className='flex items-center gap-3'>
									<Button
										variant='outline'
										onClick={handleCheckForUpdates}
										disabled={isCheckingUpdate || isInstallingUpdate}>
										<Download />
										{isCheckingUpdate ? 'Checking...' : 'Check for updates'}
									</Button>
									<Button
										onClick={handleInstallUpdate}
										disabled={!availableUpdate || isCheckingUpdate || isInstallingUpdate}>
										{isInstallingUpdate
											? 'Installing...'
											: availableUpdate
												? `Install ${availableUpdate.version}`
												: 'Install update'}
									</Button>
								</div>
							</CardContent>
						</Card>
					</m.div>
				</div>
			</div>
		</main>
	);
};

export default Settings;
