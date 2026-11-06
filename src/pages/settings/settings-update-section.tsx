import { Download, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsRow, SettingsRows } from '@/components/settings/settings-row';

type SettingsUpdateSectionProps = {
	currentVersion: string;
	isVersionReady: boolean;
	updateMessage: string;
	errorMessage: string | null;
	isCheckingUpdate: boolean;
	isInstallingUpdate: boolean;
	availableUpdateVersion: string | null;
	onCheckForUpdates: () => Promise<void> | void;
	onInstallUpdate: () => Promise<void> | void;
	/** Servers whose process is running: installing closes mserve and kills them. */
	liveServerNames: string[];
};

const SettingsUpdateSection: React.FC<SettingsUpdateSectionProps> = ({
	currentVersion,
	isVersionReady,
	updateMessage,
	errorMessage,
	isCheckingUpdate,
	isInstallingUpdate,
	availableUpdateVersion,
	onCheckForUpdates,
	onInstallUpdate,
	liveServerNames,
}) => {
	const installLabel = isInstallingUpdate
		? 'Installing...'
		: availableUpdateVersion
			? `Install ${availableUpdateVersion}`
			: 'Install update';
	const installDisabled = !availableUpdateVersion || isCheckingUpdate || isInstallingUpdate;
	const installIcon = <Download className={isInstallingUpdate ? 'animate-bounce size-4' : 'size-4'} />;

	return (
		<SettingsRows>
			<SettingsRow
				title={isVersionReady ? `Current version: ${currentVersion}` : <Skeleton className='h-5 w-56' />}
				description={
					<span className={errorMessage ? 'text-destructive' : undefined}>{updateMessage}</span>
				}>
				<div className='flex flex-wrap items-center gap-3'>
					<Button
						variant='secondary'
						onClick={onCheckForUpdates}
						disabled={isCheckingUpdate || isInstallingUpdate}>
						<RefreshCcw className={isCheckingUpdate ? 'animate-spin size-4' : 'size-4'} />
						{isCheckingUpdate ? 'Checking...' : 'Check for updates'}
					</Button>
					{liveServerNames.length > 0 ? (
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button disabled={installDisabled}>
									{installIcon}
									{installLabel}
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Stop your servers first?</AlertDialogTitle>
									<AlertDialogDescription>
										Installing the update closes MSERVE, which force shuts down{' '}
										{liveServerNames.join(', ')}. Anything not saved yet may be lost. Stop them
										first to shut them down safely.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction variant='destructive' onClick={() => void onInstallUpdate()}>
										Install anyway
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					) : (
						<Button onClick={onInstallUpdate} disabled={installDisabled}>
							{installIcon}
							{installLabel}
						</Button>
					)}
				</div>
			</SettingsRow>
		</SettingsRows>
	);
};

export default SettingsUpdateSection;
