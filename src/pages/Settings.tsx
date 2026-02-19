import React from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { m } from 'motion/react';
import { ModeToggle } from '../components/mode-toggle';
import { Palette, Trash } from 'lucide-react';
import { useServers } from '../data/servers';
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
	const [dataMessage, setDataMessage] = React.useState('');
	const { resetServers } = useServers();

	const handleClearAllData = () => {
		resetServers();
		toast.success('All data has been cleared!');
		setTimeout(() => setDataMessage(''), 3000);
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
								{dataMessage && (
									<div className='p-3 rounded-md bg-green-500/10 text-green-600 dark:text-green-400 text-sm'>
										{dataMessage}
									</div>
								)}
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
				</div>
				<m.p
					initial={{ scale: 0.75, y: 10, opacity: 0 }}
					whileInView={{ scale: 1, y: 0, opacity: 1 }}
					transition={{ type: 'spring', duration: 0.5, delay: 0.2, bounce: 0 }}
					className='mt-3 text-muted-foreground'>
					Version 3.0.0
				</m.p>
			</div>
		</main>
	);
};

export default Settings;
