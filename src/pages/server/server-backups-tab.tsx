import React from 'react';
import { Archive, ArchiveRestore, EllipsisVertical, Trash } from 'lucide-react';
import OpenFolderButton from '@/components/open-folder-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/components/ui/drawer';
import { type Server } from '@/data/servers';

type Backup = {
	directory: string;
	createdAt: Date;
};

type ServerBackupsTabProps = {
	backups: Backup[];
	server: Server;
	isBusy: boolean;
	isOnline: boolean;
	onCreateBackup: () => void;
	onRestoreBackup: (backupDirectory: string) => void;
	onDeleteBackup: (backupDirectory: string) => void;
	onSetStorageLimit: (storageLimitGb: number) => void;
	onSetDeleteInterval: (intervalMinutes: number) => void;
	onClearAllBackups: () => void;
};

const ServerBackupsTab: React.FC<ServerBackupsTabProps> = ({
	backups,
	isBusy,
	isOnline,
	server,
	onCreateBackup,
	onRestoreBackup,
	onDeleteBackup,
	onSetStorageLimit,
	onSetDeleteInterval,
	onClearAllBackups,
}) => {
	const [isStorageDrawerOpen, setIsStorageDrawerOpen] = React.useState(false);
	const [isIntervalDrawerOpen, setIsIntervalDrawerOpen] = React.useState(false);
	const [isClearAllDialogOpen, setIsClearAllDialogOpen] = React.useState(false);
	const [storageLimitInput, setStorageLimitInput] = React.useState(String(server.storage_limit ?? 200));
	const [intervalInput, setIntervalInput] = React.useState(String(server.auto_backup_interval ?? 120));

	React.useEffect(() => {
		setStorageLimitInput(String(server.storage_limit ?? 200));
	}, [server.storage_limit]);

	React.useEffect(() => {
		setIntervalInput(String(server.auto_backup_interval ?? 120));
	}, [server.auto_backup_interval]);

	const handleSaveStorageLimit = () => {
		const value = Math.max(1, Math.round(Number(storageLimitInput) || server.storage_limit || 200));
		onSetStorageLimit(value);
		setIsStorageDrawerOpen(false);
	};

	const handleSaveDeleteInterval = () => {
		const value = Math.max(1, Math.round(Number(intervalInput) || server.auto_backup_interval || 120));
		onSetDeleteInterval(value);
		setIsIntervalDrawerOpen(false);
	};

	const handleClearAllBackups = () => {
		onClearAllBackups();
		setIsClearAllDialogOpen(false);
	};

	return (
		<div className='flex flex-col gap-4 min-h-[50vh]'>
			<div className='flex justify-between items-center min-h-10'>
				<p className='text-2xl font-bold flex items-center gap-2'>
					<Archive />
					Backups
				</p>
				<div className='flex gap-2'>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant='outline' size='icon'>
								<EllipsisVertical />
								<span className='sr-only'>Backup Drop Down Menu</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align='end'>
							<DropdownMenuLabel>Storage Limit: {server.storage_limit}</DropdownMenuLabel>
							<DropdownMenuItem onSelect={() => setIsStorageDrawerOpen(true)}>
								Set storage limit
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => setIsIntervalDrawerOpen(true)}>
								Set interval to delete old backups
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => setIsClearAllDialogOpen(true)}
								className='text-destructive hover:text-destructive-active'>
								<Trash /> Clear all Backups
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button onClick={onCreateBackup} disabled={isBusy || isOnline}>
						Create Backup
					</Button>
				</div>
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
									<Button variant='destructive-secondary' disabled={isBusy || isOnline}>
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

			<Drawer open={isStorageDrawerOpen} onOpenChange={setIsStorageDrawerOpen}>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>Set backup storage limit</DrawerTitle>
						<DrawerDescription>
							Backups older than your storage budget can be removed first.
						</DrawerDescription>
					</DrawerHeader>
					<div className='px-4 space-y-2'>
						<Label htmlFor='backup-storage-limit'>Storage limit (GB)</Label>
						<Input
							id='backup-storage-limit'
							type='number'
							min={1}
							value={storageLimitInput}
							onChange={(event) => setStorageLimitInput(event.target.value)}
						/>
					</div>
					<DrawerFooter>
						<Button variant='outline' onClick={() => setIsStorageDrawerOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleSaveStorageLimit} disabled={isBusy || isOnline}>
							Save
						</Button>
					</DrawerFooter>
				</DrawerContent>
			</Drawer>

			<Drawer open={isIntervalDrawerOpen} onOpenChange={setIsIntervalDrawerOpen}>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>Set old backup cleanup interval</DrawerTitle>
						<DrawerDescription>
							Choose how often old backups should be considered for cleanup.
						</DrawerDescription>
					</DrawerHeader>
					<div className='px-4 space-y-2'>
						<Label htmlFor='backup-cleanup-interval'>Interval (minutes)</Label>
						<Input
							id='backup-cleanup-interval'
							type='number'
							min={1}
							value={intervalInput}
							onChange={(event) => setIntervalInput(event.target.value)}
						/>
					</div>
					<DrawerFooter>
						<Button variant='outline' onClick={() => setIsIntervalDrawerOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleSaveDeleteInterval} disabled={isBusy || isOnline}>
							Save
						</Button>
					</DrawerFooter>
				</DrawerContent>
			</Drawer>

			<AlertDialog open={isClearAllDialogOpen} onOpenChange={setIsClearAllDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete all backups?</AlertDialogTitle>
						<AlertDialogDescription>
							This will move every backup to your recycle bin.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							onClick={handleClearAllBackups}
							disabled={isBusy || isOnline}>
							Clear all Backups
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
};

export default React.memo(ServerBackupsTab);
