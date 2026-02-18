import React from 'react';
import { Archive, ArchiveRestore, Trash } from 'lucide-react';
import OpenFolderButton from '@/components/open-folder-button';
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
import { getBackupNameFromPath } from './server-utils';

type Backup = {
	directory: string;
	createdAt: Date;
};

type ServerBackupsTabProps = {
	backups: Backup[];
	isBusy: boolean;
	isOnline: boolean;
	onCreateBackup: () => void;
	onRestoreBackup: (backupDirectory: string) => void;
	onDeleteBackup: (backupDirectory: string) => void;
};

const ServerBackupsTab: React.FC<ServerBackupsTabProps> = ({
	backups,
	isBusy,
	isOnline,
	onCreateBackup,
	onRestoreBackup,
	onDeleteBackup,
}) => (
	<div className='flex flex-col gap-4 min-h-[50vh]'>
		<div className='flex justify-between items-center min-h-10'>
			<p className='text-2xl font-bold flex items-center gap-2'>
				<Archive />
				Backups
			</p>
			<Button onClick={onCreateBackup} disabled={isBusy || isOnline}>
				Create Backup
			</Button>
		</div>
		{backups.length === 0 ? (
			<p className='text-muted-foreground text-center my-10'>No backups were found.</p>
		) : (
			backups.map((backup) => (
				<div
					key={backup.directory}
					className='border border-border rounded-lg p-3 flex items-center justify-between gap-3'>
					<div>
						<p className='font-semibold'>{getBackupNameFromPath(backup.directory)}</p>
						<p className='text-sm text-muted-foreground'>
							Created {new Date(backup.createdAt).toLocaleString()}
						</p>
					</div>
					<div className='flex gap-2'>
						<OpenFolderButton targetPath={backup.directory} disabled={isBusy} />
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button variant='secondary' disabled={isBusy || isOnline}>
									<ArchiveRestore />
									Restore
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Are you sure?</AlertDialogTitle>
									<AlertDialogDescription>
										This will restore the backup from {backup.createdAt.toLocaleDateString()}{' '}
										{backup.createdAt.toLocaleTimeString()}
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction onClick={() => onRestoreBackup(backup.directory)}>
										Restore Backup
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button
									variant='secondary'
									className='hover:text-red-400'
									disabled={isBusy || isOnline}>
									<Trash />
									Delete
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Delete backup?</AlertDialogTitle>
									<AlertDialogDescription>
										This moves the backup to your recycle bin.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction
										variant='destructive'
										onClick={() => onDeleteBackup(backup.directory)}>
										Delete Backup
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</div>
				</div>
			))
		)}
	</div>
);

export default React.memo(ServerBackupsTab);
