import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type SettingsUpdateCardProps = {
	currentVersion: string;
	isVersionReady: boolean;
	updateMessage: string;
	errorMessage: string | null;
	isCheckingUpdate: boolean;
	isInstallingUpdate: boolean;
	availableUpdateVersion: string | null;
	onCheckForUpdates: () => Promise<void> | void;
	onInstallUpdate: () => Promise<void> | void;
};

const SettingsUpdateCard: React.FC<SettingsUpdateCardProps> = ({
	currentVersion,
	isVersionReady,
	updateMessage,
	errorMessage,
	isCheckingUpdate,
	isInstallingUpdate,
	availableUpdateVersion,
	onCheckForUpdates,
	onInstallUpdate,
}) => {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Updates</CardTitle>
				<CardDescription>Check and install over-the-air updates.</CardDescription>
			</CardHeader>
			<CardContent className='space-y-4'>
				<div>
					{isVersionReady ? (
						<p className='font-medium'>Current version: {currentVersion}</p>
					) : (
						<div className='space-y-2'>
							<Skeleton className='h-5 w-56' />
						</div>
					)}
					<p className={`text-sm ${errorMessage ? 'text-destructive' : 'text-muted-foreground'}`}>
						{updateMessage}
					</p>
				</div>
				<div className='flex items-center gap-3'>
					<Button
						variant='outline'
						onClick={onCheckForUpdates}
						disabled={isCheckingUpdate || isInstallingUpdate}>
						<Download />
						{isCheckingUpdate ? 'Checking...' : 'Check for updates'}
					</Button>
					<Button
						onClick={onInstallUpdate}
						disabled={!availableUpdateVersion || isCheckingUpdate || isInstallingUpdate}>
						{isInstallingUpdate
							? 'Installing...'
							: availableUpdateVersion
								? `Install ${availableUpdateVersion}`
								: 'Install update'}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
};

export default SettingsUpdateCard;
