import React from 'react';
import {
	Archive,
	ArchiveRestore,
	CircleX,
	Clock3,
	EllipsisVertical,
	HardDrive,
	Lock,
	LockOpen,
	Pencil,
	Settings2,
	Trash,
} from 'lucide-react';
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
	DropdownMenuSeparator,
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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { type Server } from '@/data/servers';
import type { AutoBackupMode, BackupPolicy, BackupScopeItem } from '@/lib/mserve-schema';
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';
import { HelpButton } from '@/components/help/help-button';
import type { BackupSettingsUpdate } from './hooks/use-server-backup-actions';
import { formatBytes, getBackupNameFromPath } from './server-utils';

type Backup = Server['backups'][number];

type ServerBackupsTabProps = {
	backups: Backup[];
	server: Server;
	isBusy: boolean;
	isOnline: boolean;
	onCreateBackup: (name?: string) => Promise<void> | void;
	onRestoreBackup: (backupDirectory: string) => Promise<void> | void;
	onDeleteBackup: (backupDirectory: string) => Promise<void> | void;
	onSetBackupLocked: (backupDirectory: string, locked: boolean) => Promise<void> | void;
	onSaveBackupSettings: (settings: BackupSettingsUpdate) => Promise<void>;
	onClearAllBackups: () => Promise<void> | void;
};

const REASON_LABELS: Record<string, string> = {
	manual: 'Manual',
	on_start: 'Auto · on start',
	on_close: 'Auto · on close',
	interval: 'Auto · interval',
	pre_restore: 'Safety · before restore',
};

const SCOPE_LABELS: Record<BackupScopeItem, string> = {
	worlds: 'Worlds',
	plugins: 'Plugins',
	mods: 'Mods',
	configs: 'Configs',
};

const SCOPE_DESCRIPTIONS: Record<BackupScopeItem, string> = {
	worlds: 'All active worlds, including their datapacks.',
	plugins: 'The plugins folder, including plugin configs and data.',
	mods: 'The mods folder.',
	configs: 'server.properties, whitelist/ops, YAML configs and the config folder.',
};

const BACKUP_TRIGGERS: { value: AutoBackupMode; label: string; description: string }[] = [
	{ value: 'on_start', label: 'When the server starts', description: 'Snapshot right after startup.' },
	{ value: 'on_close', label: 'When the server stops', description: 'Snapshot after a clean stop or crash.' },
	{ value: 'interval', label: 'On a timer while running', description: 'Repeats while the server is online.' },
];

const backupDisplayName = (backup: Backup) => backup.name || getBackupNameFromPath(backup.directory);

const Chip: React.FC<{ children: React.ReactNode; tone?: 'default' | 'accent' | 'warning' }> = ({
	children,
	tone = 'default',
}) => (
	<span
		className={
			tone === 'accent'
				? 'rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary'
				: tone === 'warning'
					? 'rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400'
					: 'rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground'
		}>
		{children}
	</span>
);

/** Human summary of the active retention rules, shown under the header. */
const buildRetentionSummary = (server: Server): string => {
	const parts: string[] = [];
	parts.push(server.backup_policy === 'smart' ? 'Smart retention' : 'Simple retention');
	if (server.backup_max_count > 0) parts.push(`keep ≤ ${server.backup_max_count}`);
	if (server.backup_max_age_days > 0) parts.push(`delete after ${server.backup_max_age_days}d`);
	parts.push(`${server.storage_limit} GB limit`);
	return parts.join(' · ');
};

const BackupSettingsDrawer: React.FC<{
	server: Server;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (settings: BackupSettingsUpdate) => Promise<void>;
}> = ({ server, open, onOpenChange, onSave }) => {
	const capabilities = React.useMemo(
		() => getServerProviderCapabilities(server.provider),
		[server.provider],
	);

	const [autoBackup, setAutoBackup] = React.useState<AutoBackupMode[]>(server.auto_backup);
	const [interval, setInterval] = React.useState(server.auto_backup_interval);
	const [scope, setScope] = React.useState<BackupScopeItem[]>(server.backup_scope);
	const [policy, setPolicy] = React.useState<BackupPolicy>(server.backup_policy);
	const [maxCount, setMaxCount] = React.useState(server.backup_max_count);
	const [maxAgeDays, setMaxAgeDays] = React.useState(server.backup_max_age_days);
	const [storageLimit, setStorageLimit] = React.useState(server.storage_limit);
	const [isSaving, setIsSaving] = React.useState(false);

	// Re-seed the form each time the sheet opens so stale edits don't linger.
	React.useEffect(() => {
		if (!open) return;
		setAutoBackup(server.auto_backup);
		setInterval(server.auto_backup_interval);
		setScope(server.backup_scope);
		setPolicy(server.backup_policy);
		setMaxCount(server.backup_max_count);
		setMaxAgeDays(server.backup_max_age_days);
		setStorageLimit(server.storage_limit);
	}, [open, server]);

	// Mods only exist on modded servers; plugins only where a plugins folder
	// makes sense. Hiding irrelevant scopes keeps the sheet approachable.
	const visibleScopes = React.useMemo(
		() =>
			(Object.keys(SCOPE_LABELS) as BackupScopeItem[]).filter((item) => {
				if (item === 'mods') return capabilities.kind === 'modded';
				if (item === 'plugins') return capabilities.kind !== 'modded' && capabilities.kind !== 'vanilla';
				return true;
			}),
		[capabilities.kind],
	);

	const toggleTrigger = (mode: AutoBackupMode, enabled: boolean) => {
		setAutoBackup((current) =>
			enabled ? Array.from(new Set([...current, mode])) : current.filter((item) => item !== mode),
		);
	};

	const toggleScope = (item: BackupScopeItem, enabled: boolean) => {
		setScope((current) => {
			const next = enabled ? Array.from(new Set([...current, item])) : current.filter((entry) => entry !== item);
			return next;
		});
	};

	const parseCap = (value: string) => Math.max(0, Math.round(Number(value) || 0));

	const handleSave = async () => {
		if (scope.length === 0) return;
		setIsSaving(true);
		try {
			await onSave({
				auto_backup: autoBackup,
				auto_backup_interval: Math.max(1, Math.round(Number(interval) || 120)),
				storage_limit: Math.max(1, Math.round(Number(storageLimit) || 200)),
				backup_policy: policy,
				backup_max_count: maxCount,
				backup_max_age_days: maxAgeDays,
				backup_scope: scope,
			});
			onOpenChange(false);
		} catch {
			// Error toasts are handled by the callback.
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<Drawer open={open} onOpenChange={onOpenChange} direction='right'>
			<DrawerContent className='!max-w-md'>
				<DrawerHeader>
					<DrawerTitle>Backup settings</DrawerTitle>
					<DrawerDescription>
						Changes apply to future backups. Retention runs immediately after saving.
					</DrawerDescription>
				</DrawerHeader>

				<div className='flex-1 space-y-6 overflow-y-auto px-4 pb-4'>
					<section>
						<p className='mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground'>
							Automatic backups
						</p>
						<div className='space-y-2'>
							{BACKUP_TRIGGERS.map((trigger) => (
								<label
									key={trigger.value}
									className='flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/40'>
									<Checkbox
										className='mt-0.5'
										checked={autoBackup.includes(trigger.value)}
										onCheckedChange={(checked) => toggleTrigger(trigger.value, checked === true)}
									/>
									<span>
										<span className='block text-sm font-medium'>{trigger.label}</span>
										<span className='block text-xs text-muted-foreground'>{trigger.description}</span>
									</span>
								</label>
							))}
						</div>
						{autoBackup.includes('interval') && (
							<div className='mt-2 space-y-1.5'>
								<Label htmlFor='backup-interval-minutes'>Backup every</Label>
								<InputGroup>
									<InputGroupInput
										id='backup-interval-minutes'
										type='number'
										min={1}
										value={interval}
										onChange={(event) => setInterval(Math.max(1, Number(event.target.value) || 1))}
									/>
									<InputGroupAddon className='font-mono text-xs font-bold uppercase' align='inline-end'>
										Minutes
									</InputGroupAddon>
								</InputGroup>
							</div>
						)}
					</section>

					<section>
						<p className='mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground'>
							What to include
						</p>
						<div className='space-y-2'>
							{visibleScopes.map((item) => (
								<label
									key={item}
									className='flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/40'>
									<Checkbox
										className='mt-0.5'
										checked={scope.includes(item)}
										onCheckedChange={(checked) => toggleScope(item, checked === true)}
									/>
									<span>
										<span className='block text-sm font-medium'>{SCOPE_LABELS[item]}</span>
										<span className='block text-xs text-muted-foreground'>{SCOPE_DESCRIPTIONS[item]}</span>
									</span>
								</label>
							))}
						</div>
						{scope.length === 0 && (
							<p className='mt-2 text-xs text-destructive'>Select at least one thing to back up.</p>
						)}
					</section>

					<section>
						<p className='mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground'>Retention</p>
						<div className='space-y-3'>
							<div className='space-y-1.5'>
								<Label>Cleanup policy</Label>
								<Select value={policy} onValueChange={(value) => setPolicy(value === 'simple' ? 'simple' : 'smart')}>
									<SelectTrigger className='w-full'>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value='smart'>Smart (recommended)</SelectItem>
										<SelectItem value='simple'>Simple — only the limits below</SelectItem>
									</SelectContent>
								</Select>
								<p className='text-xs text-muted-foreground'>
									{policy === 'smart'
										? 'Keeps every backup from the last 2 days, then one per day, one per week, and one per month. Locked backups are always kept.'
										: 'Backups are only removed by the limits below (oldest first). Locked backups are always kept.'}
								</p>
							</div>

							<div className='grid grid-cols-2 gap-3'>
								<div className='space-y-1.5'>
									<Label htmlFor='backup-max-count'>Max backups</Label>
									<Input
										id='backup-max-count'
										type='number'
										min={0}
										value={maxCount}
										onChange={(event) => setMaxCount(parseCap(event.target.value))}
									/>
									<p className='text-[11px] text-muted-foreground'>0 = unlimited</p>
								</div>
								<div className='space-y-1.5'>
									<Label htmlFor='backup-max-age'>Max age (days)</Label>
									<Input
										id='backup-max-age'
										type='number'
										min={0}
										value={maxAgeDays}
										onChange={(event) => setMaxAgeDays(parseCap(event.target.value))}
									/>
									<p className='text-[11px] text-muted-foreground'>0 = unlimited</p>
								</div>
							</div>

							<div className='space-y-1.5'>
								<Label htmlFor='backup-storage-limit'>Storage limit</Label>
								<InputGroup>
									<InputGroupInput
										id='backup-storage-limit'
										type='number'
										min={1}
										value={storageLimit}
										onChange={(event) => setStorageLimit(Math.max(1, Number(event.target.value) || 1))}
									/>
									<InputGroupAddon className='font-mono text-xs font-bold uppercase' align='inline-end'>
										Gigabytes
									</InputGroupAddon>
								</InputGroup>
								<p className='text-[11px] text-muted-foreground'>
									Hard cap for all backups combined. Oldest unlocked backups are removed to stay under it.
								</p>
							</div>
						</div>
					</section>
				</div>

				<DrawerFooter className='flex-row justify-end gap-2'>
					<Button variant='outline' onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={isSaving || scope.length === 0}>
						Save settings
					</Button>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
};

const ServerBackupsTab: React.FC<ServerBackupsTabProps> = ({
	backups,
	isBusy,
	isOnline,
	server,
	onCreateBackup,
	onRestoreBackup,
	onDeleteBackup,
	onSetBackupLocked,
	onSaveBackupSettings,
	onClearAllBackups,
}) => {
	const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
	const [isClearAllDialogOpen, setIsClearAllDialogOpen] = React.useState(false);
	const [isNameDialogOpen, setIsNameDialogOpen] = React.useState(false);
	const [backupName, setBackupName] = React.useState('');

	const totalSizeBytes = React.useMemo(
		() => backups.reduce((total, backup) => total + Math.max(0, Number(backup.size) || 0), 0),
		[backups],
	);
	const limitBytes = Math.max(1, server.storage_limit) * 1024 * 1024 * 1024;
	const usagePercent = Math.min(100, Math.round((totalSizeBytes / limitBytes) * 100));
	const lockedCount = React.useMemo(() => backups.filter((backup) => backup.locked).length, [backups]);

	const handleCreateNamed = () => {
		const trimmed = backupName.trim();
		setIsNameDialogOpen(false);
		setBackupName('');
		void onCreateBackup(trimmed || undefined);
	};

	return (
		<div className='flex flex-col gap-4'>
			<div className='flex justify-between items-center min-h-10'>
				<p className='text-2xl font-bold flex items-center gap-2'>
					<Archive />
					Backups
					<HelpButton topic='backups' />
				</p>
				<div className='flex gap-2'>
					<Button variant='outline' onClick={() => setIsSettingsOpen(true)}>
						<Settings2 /> Settings
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant='outline' size='icon'>
								<EllipsisVertical />
								<span className='sr-only'>More backup actions</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align='end'>
							<DropdownMenuItem
								disabled={isBusy || isOnline}
								onSelect={() => setIsNameDialogOpen(true)}>
								<Pencil /> Create named backup…
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onSelect={() => setIsClearAllDialogOpen(true)}
								className='group text-destructive font-bold'>
								<Trash className='text-destructive group-hover:text-foreground' /> Clear all Backups
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button onClick={() => void onCreateBackup()} disabled={isBusy || isOnline}>
						Create Backup
					</Button>
				</div>
			</div>

			{/* Storage + retention summary */}
			<div className='rounded-2xl border bg-card p-4'>
				<div className='flex flex-wrap items-center justify-between gap-2 text-sm'>
					<span className='font-medium'>
						{backups.length} backup{backups.length === 1 ? '' : 's'}
						{lockedCount > 0 && (
							<span className='text-muted-foreground'> · {lockedCount} locked</span>
						)}
					</span>
					<span className='text-muted-foreground'>
						{formatBytes(totalSizeBytes)} of {server.storage_limit} GB used
					</span>
				</div>
				<div className='mt-2 h-2 overflow-hidden rounded-full bg-muted'>
					<div
						className={usagePercent >= 90 ? 'h-full bg-destructive' : 'h-full bg-primary'}
						style={{ width: `${Math.max(usagePercent, totalSizeBytes > 0 ? 2 : 0)}%` }}
					/>
				</div>
				<p className='mt-2 text-xs text-muted-foreground'>{buildRetentionSummary(server)}</p>
			</div>

			{isOnline && (
				<p className='text-xs text-muted-foreground'>
					Manual backups and restores are disabled while the server is online. Automatic backups keep running.
				</p>
			)}

			{backups.length === 0 ? (
				<div className='my-10 text-muted-foreground text-center flex flex-col items-center gap-4'>
					<CircleX className='size-20' />
					<p>No backups yet.</p>
					<p className='max-w-md text-sm'>
						Create one now, or open Settings to schedule automatic backups on start, on stop, or on a timer.
					</p>
				</div>
			) : (
				backups.map((backup) => (
					<Card key={backup.directory}>
						<CardHeader className='border-b-2 border-b-border'>
							<div className='flex items-start justify-between gap-4'>
								<CardTitle className='flex flex-wrap items-center gap-2'>
									{backupDisplayName(backup)}
									{backup.locked && (
										<Chip tone='accent'>
											<Lock className='mr-1 inline size-3' />
											Locked
										</Chip>
									)}
									{backup.reason && <Chip>{REASON_LABELS[backup.reason] ?? backup.reason}</Chip>}
								</CardTitle>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant='ghost'
											size='icon'
											disabled={isBusy}
											onClick={() => void onSetBackupLocked(backup.directory, !backup.locked)}>
											{backup.locked ? <Lock /> : <LockOpen />}
											<span className='sr-only'>{backup.locked ? 'Unlock backup' : 'Lock backup'}</span>
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p className='font-bold'>
											{backup.locked
												? 'Unlock — retention may remove it again'
												: 'Lock — retention will never remove it'}
										</p>
									</TooltipContent>
								</Tooltip>
							</div>
							<CardDescription className='flex flex-wrap items-center gap-x-6 gap-y-2'>
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

								{backup.contents && backup.contents.length > 0 && (
									<span className='flex items-center gap-1.5'>
										{backup.contents.map((item) => (
											<Chip key={item}>{SCOPE_LABELS[item as BackupScopeItem] ?? item}</Chip>
										))}
									</span>
								)}
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
										<AlertDialogTitle>Restore this backup?</AlertDialogTitle>
										<AlertDialogDescription>
											This restores{' '}
											{backup.contents && backup.contents.length > 0
												? backup.contents
														.map((item) => (SCOPE_LABELS[item as BackupScopeItem] ?? item).toLowerCase())
														.join(', ')
												: 'the backup contents'}{' '}
											from {backup.created_at.toLocaleString()}. A safety backup of the current state is
											created first.
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
											{backup.locked
												? 'This backup is locked, but a manual delete still moves it to your recycle bin.'
												: 'This moves the backup to your recycle bin.'}
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

			<BackupSettingsDrawer
				server={server}
				open={isSettingsOpen}
				onOpenChange={setIsSettingsOpen}
				onSave={onSaveBackupSettings}
			/>

			{/* Named backup dialog */}
			<AlertDialog open={isNameDialogOpen} onOpenChange={setIsNameDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Create named backup</AlertDialogTitle>
						<AlertDialogDescription>
							Give this backup a label so it's easy to find later (e.g. "before 1.21 update").
						</AlertDialogDescription>
					</AlertDialogHeader>
					<Input
						autoFocus
						placeholder='Backup name'
						value={backupName}
						maxLength={80}
						onChange={(event) => setBackupName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') handleCreateNamed();
						}}
					/>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setBackupName('')}>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleCreateNamed} disabled={isBusy || isOnline}>
							Create Backup
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={isClearAllDialogOpen} onOpenChange={setIsClearAllDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete all backups?</AlertDialogTitle>
						<AlertDialogDescription>
							This moves every backup to your recycle bin
							{lockedCount > 0
								? ` — including ${lockedCount} locked backup${lockedCount === 1 ? '' : 's'}.`
								: '.'}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							onClick={() => {
								void onClearAllBackups();
								setIsClearAllDialogOpen(false);
							}}
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
