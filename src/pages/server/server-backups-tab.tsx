import React from 'react';
import { Archive, ArchiveRestore, CircleX, Clock3, EllipsisVertical, HardDrive, Trash } from 'lucide-react';
import OpenFolderButton from '@/components/open-folder-button';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type Server } from '@/data/servers';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { formatBytes, getBackupNameFromPath } from './server-utils';

type Backup = {
	directory: string;
	created_at: Date;
	size?: number;
};

type ServerBackupsTabProps = {
	backups: Backup[];
	server: Server;
	isBusy: boolean;
	isOnline: boolean;
	onCreateBackup: () => Promise<void> | void;
	onRestoreBackup: (backupDirectory: string) => Promise<void> | void;
	onDeleteBackup: (backupDirectory: string) => Promise<void> | void;
	onSetStorageLimit: (storageLimitGb: number) => Promise<void> | void;
	onClearAllBackups: () => Promise<void> | void;
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
	onClearAllBackups,
}) => {
	const [isStorageDrawerOpen, setIsStorageDrawerOpen] = React.useState(false);
	const [isClearAllDialogOpen, setIsClearAllDialogOpen] = React.useState(false);
	const [storageLimitInput, setStorageLimitInput] = React.useState(server.storage_limit);

	React.useEffect(() => {
		setStorageLimitInput(server.storage_limit);
	}, [server.storage_limit]);

	const handleSaveStorageLimit = async () => {
		const value = Math.max(1, Math.round(storageLimitInput || server.storage_limit || 200));
		try {
			await onSetStorageLimit(value);
			setIsStorageDrawerOpen(false);
		} catch {
			// Error toasts are handled by the callback.
		}
	};

	const handleClearAllBackups = () => {
		void onClearAllBackups();
		setIsClearAllDialogOpen(false);
	};

	return (
		<div className='flex flex-col gap-4'>
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
							<DropdownMenuItem
								onSelect={() => setIsClearAllDialogOpen(true)}
								className='group text-destructive font-bold'>
								<Trash className='text-destructive group-hover:text-foreground' /> Clear all Backups
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button onClick={onCreateBackup} disabled={isBusy || isOnline}>
						Create Backup
					</Button>
				</div>
			</div>
			{backups.length === 0 ? (
				<div className='my-10 text-muted-foreground text-center flex flex-col items-center gap-4'>
					<CircleX className='size-20' />
					<p>No backups were found.</p>
				</div>
			) : (
				backups.map((backup) => (
					<Card key={backup.directory}>
						<CardHeader className='border-b-2 border-b-border'>
							<div className='flex items-start justify-between gap-4'>
								<CardTitle>{getBackupNameFromPath(backup.directory)}</CardTitle>
							</div>
							<CardDescription className='flex items-center gap-6'>
								<Tooltip>
									<TooltipTrigger asChild>
										<div className='flex items-center lg:text-lg gap-2'>
											<HardDrive className='size-4' />
											{formatBytes(backup.size)}
										</div>
									</TooltipTrigger>
									<TooltipContent>
										<p className='font-bold'>Backup Size</p>
									</TooltipContent>
								</Tooltip>

								<Tooltip>
									<TooltipTrigger asChild>
										<div className='flex items-center lg:text-lg gap-2'>
											<Clock3 className='size-4' />
											{backup.created_at.toLocaleString()}
										</div>
									</TooltipTrigger>
									<TooltipContent>
										<p className='font-bold'>Exact time Created</p>
									</TooltipContent>
								</Tooltip>
							</CardDescription>
						</CardHeader>
						<CardContent className='flex flex-wrap gap-2'>
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
											This will restore the backup from {backup.created_at.toLocaleDateString()}{' '}
											{backup.created_at.toLocaleTimeString()}
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
						</CardContent>
					</Card>
				))
			)}

			<Drawer open={isStorageDrawerOpen} onOpenChange={setIsStorageDrawerOpen}>
				<DrawerContent className='flex flex-col items-center'>
					<DrawerHeader>
						<DrawerTitle>Set backup storage limit</DrawerTitle>
						<DrawerDescription>
							Backups older than your storage budget can be removed first.
						</DrawerDescription>
					</DrawerHeader>
					<div className='px-4 space-y-2 w-md'>
						<Label htmlFor='backup-storage-limit'>Storage limit</Label>
						<InputGroup>
							<InputGroupInput
								id='backup-storage-limit'
								type='number'
								min={1}
								value={storageLimitInput}
								onChange={(event) => setStorageLimitInput(Number(event.target.value))}
							/>
							<InputGroupAddon className='font-mono font-bold uppercase text-xs' align='inline-end'>
								Gigabytes
							</InputGroupAddon>
						</InputGroup>
					</div>
					<DrawerFooter className='w-md'>
						<Button variant='outline' onClick={() => setIsStorageDrawerOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleSaveStorageLimit} disabled={isBusy || isOnline}>
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
