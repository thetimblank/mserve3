import React from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { m } from 'motion/react';
import { ModeToggle } from '../components/mode-toggle';
import { Palette } from 'lucide-react';
import { useServers } from '../data/servers';

const Settings: React.FC = () => {
	const [userName, setUserName] = React.useState('Tim');
	const [email, setEmail] = React.useState('tim@example.com');
	const [saveMessage, setSaveMessage] = React.useState('');
	const [dataMessage, setDataMessage] = React.useState('');
	const { resetServers } = useServers();

	const handleSaveProfile = () => {
		setSaveMessage('Profile saved successfully!');
		setTimeout(() => setSaveMessage(''), 3000);
	};

	const handleClearAllData = () => {
		if (!window.confirm('This will remove all servers and restore defaults. Continue?')) return;
		resetServers();
		setDataMessage('All server data cleared and restored to defaults.');
		setTimeout(() => setDataMessage(''), 3000);
	};

	return (
		<main className='pt-15 min-h-[calc(100vh-40px)] p-12 w-full overflow-y-auto'>
			<div className='flex flex-col min-w-1/2 max-w-2xl'>
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
						initial={{ y: 50, opacity: 0 }}
						whileInView={{ y: 0, opacity: 1 }}
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
								<div className='flex items-center justify-between p-4 rounded-lg border'>
									<div>
										<p className='font-medium'>Theme</p>
										<p className='text-sm text-muted-foreground'>
											Choose between light and dark mode
										</p>
									</div>
									<ModeToggle />
								</div>
							</CardContent>
						</Card>
					</m.div>

					{/* Profile Settings */}
					<m.div
						initial={{ y: 50, opacity: 0 }}
						whileInView={{ y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, delay: 0.1, bounce: 0 }}>
						<Card>
							<CardHeader>
								<CardTitle>Profile</CardTitle>
								<CardDescription>Manage your account information</CardDescription>
							</CardHeader>
							<CardContent className='space-y-4'>
								<div>
									<label className='block text-sm font-medium mb-2'>Name</label>
									<input
										type='text'
										value={userName}
										onChange={(e) => setUserName(e.target.value)}
										className='w-full px-3 py-2 border border-input rounded-md bg-background'
										placeholder='Your name'
									/>
								</div>
								<div>
									<label className='block text-sm font-medium mb-2'>Email</label>
									<input
										type='email'
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										className='w-full px-3 py-2 border border-input rounded-md bg-background'
										placeholder='your@email.com'
									/>
								</div>
								{saveMessage && (
									<div className='p-3 rounded-md bg-green-500/10 text-green-600 dark:text-green-400 text-sm'>
										{saveMessage}
									</div>
								)}
								<Button onClick={handleSaveProfile} className='w-full'>
									Save Profile
								</Button>
							</CardContent>
						</Card>
					</m.div>

					{/* Data & Privacy */}
					<m.div
						initial={{ y: 50, opacity: 0 }}
						whileInView={{ y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, delay: 0.2, bounce: 0 }}>
						<Card>
							<CardHeader>
								<CardTitle>Data & Privacy</CardTitle>
								<CardDescription>Manage your data</CardDescription>
							</CardHeader>
							<CardContent className='space-y-3'>
								<Button variant='outline' className='w-full justify-start'>
									Export Data
								</Button>
								<Button variant='outline' className='w-full justify-start'>
									Import Data
								</Button>
								{dataMessage && (
									<div className='p-3 rounded-md bg-green-500/10 text-green-600 dark:text-green-400 text-sm'>
										{dataMessage}
									</div>
								)}
								<Button
									variant='outline'
									className='w-full justify-start text-destructive'
									onClick={handleClearAllData}>
									Clear All Data
								</Button>
							</CardContent>
						</Card>
					</m.div>

					{/* Storage Info */}
					<m.div
						initial={{ y: 50, opacity: 0 }}
						whileInView={{ y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, delay: 0.3, bounce: 0 }}>
						<Card>
							<CardHeader>
								<CardTitle>Storage</CardTitle>
								<CardDescription>Current storage status</CardDescription>
							</CardHeader>
							<CardContent className='space-y-4'>
								<div>
									<div className='flex justify-between text-sm mb-2'>
										<span className='font-medium'>Local Storage</span>
										<span className='text-muted-foreground'>localStorage (temporary)</span>
									</div>
									<p className='text-sm text-muted-foreground'>
										Your data is currently stored locally in your browser. This will be migrated to
										Firebase for cloud sync soon.
									</p>
								</div>
							</CardContent>
						</Card>
					</m.div>

					{/* Account */}
					<m.div
						initial={{ y: 50, opacity: 0 }}
						whileInView={{ y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, delay: 0.4, bounce: 0 }}>
						<Card>
							<CardHeader>
								<CardTitle>Account</CardTitle>
								<CardDescription>Account management</CardDescription>
							</CardHeader>
							<CardContent className='space-y-3'>
								<Button variant='outline' className='w-full justify-start'>
									Change Password
								</Button>
								<Button variant='outline' className='w-full justify-start'>
									Two-Factor Authentication
								</Button>
								<Button variant='outline' className='w-full justify-start text-destructive'>
									Sign Out
								</Button>
							</CardContent>
						</Card>
					</m.div>
				</div>
			</div>
		</main>
	);
};

export default Settings;
