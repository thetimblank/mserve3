import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Link2Off, Lock, RefreshCcw, Search, Trash } from 'lucide-react';
import { toast } from 'sonner';

import EditServerPropertiesForm from '@/components/edit-server-properties-form';
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
import { Container } from '@/components/ui/container';
import { Input } from '@/components/ui/input';
import { Server, useServers } from '@/data/servers';
import type { JavaRuntimeInfo } from '@/lib/java-runtime-service';
import { repairServerMserveJson, syncServerMserveJson } from '@/lib/mserve-sync';
import { requestMserveRepair } from '@/lib/mserve-repair-controller';

type Props = {
	clearTerminalSession: () => void;
	server: Server;
	javaRuntimes: JavaRuntimeInfo[];
	isBusy: boolean;
	setIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
	syncServerContents: () => Promise<void>;
};

type SectionId = 'general' | 'danger-zone';

type SectionProps = Props & {
	isLocked: boolean;
	onManualSync: () => Promise<void>;
	onRemoveServer: () => Promise<void>;
	onDeleteServer: () => Promise<void>;
};

type SectionConfig = {
	id: SectionId;
	title: string;
	description: string;
	keywords: string[];
	render: (props: SectionProps) => React.ReactNode;
};

const SERVER_SETTINGS_SECTIONS: SectionConfig[] = [
	{
		id: 'general',
		title: 'General',
		description: 'Sync mserve.json and edit server properties.',
		keywords: ['sync', 'mserve.json', 'properties', 'ram', 'storage', 'java', 'provider', 'telemetry'],
		render: (props) => <GeneralSettingsSection {...props} />,
	},
	{
		id: 'danger-zone',
		title: 'Danger Zone',
		description: 'Remove the server from mserve or delete it entirely.',
		keywords: ['delete', 'remove', 'trash', 'danger', 'recycle', 'wipe', 'destroy'],
		render: (props) => <DangerZoneSection {...props} />,
	},
];

const normalizeQuery = (value: string) => value.trim().toLowerCase();

const matchesSection = (section: SectionConfig, query: string) => {
	const normalized = normalizeQuery(query);
	if (!normalized) return true;

	return [section.title, section.description, ...section.keywords]
		.join(' ')
		.toLowerCase()
		.includes(normalized);
};

const GeneralSettingsSection: React.FC<SectionProps> = ({
	server,
	javaRuntimes,
	isBusy,
	onManualSync,
	syncServerContents,
}) => {
	const isOffline = server.status === 'offline';

	return (
		<div className='space-y-8'>
			<section className='space-y-3'>
				<div className='space-y-1'>
					<p className='text-lg font-semibold'>Sync mserve.json</p>
					<p className='text-sm text-muted-foreground'>
						Refresh the stored configuration and rebuild it if the file is missing.
					</p>
				</div>
				<Button
					variant='secondary'
					className='w-fit'
					onClick={onManualSync}
					disabled={isBusy || !isOffline}>
					<RefreshCcw />
					<span>Sync mserve.json</span>
				</Button>
			</section>

			<section className='space-y-4'>
				<div className='space-y-1'>
					<p className='text-lg font-semibold'>Server properties</p>
					<p className='text-sm text-muted-foreground'>
						Update RAM, storage, provider, telemetry, and other editable server settings.
					</p>
				</div>
				<EditServerPropertiesForm
					server={server}
					javaRuntimes={javaRuntimes}
					disabled={isBusy}
					onSaved={syncServerContents}
				/>
			</section>
		</div>
	);
};

const DangerZoneSection: React.FC<SectionProps> = ({ server, isBusy, onRemoveServer, onDeleteServer }) => {
	const disabled = isBusy || server.status === 'online';

	return (
		<div className='space-y-4'>
			<div className='space-y-1'>
				<p className='text-lg font-semibold text-destructive'>Danger Zone</p>
				<p className='text-sm text-muted-foreground'>
					Remove the server from mserve or send the files to the recycle bin.
				</p>
			</div>

			<Container variant='destructive' className='space-y-4'>
				<div className='flex flex-wrap gap-2'>
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button disabled={disabled} variant='destructive-secondary'>
								<Link2Off />
								<span>Remove Server</span>
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Are you sure?</AlertDialogTitle>
								<AlertDialogDescription>
									This will remove the server from the MSERVE app. It will lose the data associated
									with the app. However, it will NOT delete any files and it will NOT remove
									mserve.json. You can always import the server again.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									variant='destructive'
									onClick={onRemoveServer}
									className='capitalize'>
									Remove Server
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>

					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button disabled={disabled} variant='destructive'>
								<Trash />
								<span>Delete Server</span>
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Are you sure?</AlertDialogTitle>
								<AlertDialogDescription>
									This will move the server to the recycling bin.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									variant='destructive'
									className='capitalize'
									onClick={onDeleteServer}>
									Delete Server
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</Container>
		</div>
	);
};

export default function ServerSettingsPanel({
	clearTerminalSession,
	server,
	javaRuntimes,
	isBusy,
	setIsBusy,
	syncServerContents,
}: Props) {
	const navigate = useNavigate();
	const { removeServer, updateServer } = useServers();
	const [query, setQuery] = React.useState('');
	const [activeSectionId, setActiveSectionId] = React.useState<SectionId>('general');

	const handleManualSync = React.useCallback(async () => {
		if (isBusy || server.status !== 'offline') return;

		setIsBusy(true);
		try {
			let synced = await syncServerMserveJson(server.directory);

			if (synced.status === 'needs_setup') {
				if (!synced.config) {
					throw new Error('Could not load fallback mserve configuration for repair.');
				}

				const repairPayload = await requestMserveRepair({
					directory: server.directory,
					file: server.file,
					ram: server.ram,
					storage_limit: server.storage_limit,
					auto_backup: server.auto_backup,
					auto_backup_interval: server.auto_backup_interval,
					auto_restart: server.auto_restart,
					create_directory_if_missing: true,
					auto_agree_eula: true,
					java_installation: server.java_installation ?? '',
					custom_flags: server.custom_flags,
					provider: server.provider,
					telemetry_host: server.telemetry_host,
					telemetry_port: server.telemetry_port,
				});

				if (!repairPayload) {
					toast.error('Sync cancelled. mserve.json rebuild was not completed.');
					return;
				}

				synced = await repairServerMserveJson(repairPayload);
			}

			if (!synced.config) {
				throw new Error('Valid mserve.json data could not be resolved.');
			}

			updateServer(server.id, {
				id: synced.config.id,
				file: synced.config.file,
				ram: synced.config.ram,
				storage_limit: synced.config.storage_limit,
				auto_backup: synced.config.auto_backup,
				auto_backup_interval: synced.config.auto_backup_interval,
				auto_restart: synced.config.auto_restart,
				java_installation: synced.config.java_installation,
				custom_flags: synced.config.custom_flags,
				provider: synced.config.provider,
				telemetry_host: synced.config.telemetry_host,
				telemetry_port: synced.config.telemetry_port,
				created_at: synced.config.created_at,
			});

			toast.success(synced.message);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to sync mserve.json.';
			toast.error(message);
		} finally {
			setIsBusy(false);
		}
	}, [isBusy, server, setIsBusy, updateServer]);

	const handleDelete = React.useCallback(async () => {
		if (isBusy) return;

		setIsBusy(true);
		try {
			await invoke('delete_server', { directory: server.directory });
			clearTerminalSession();
			removeServer(server.id);
			navigate('/');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to delete server.';
			toast.error(message);
		} finally {
			setIsBusy(false);
		}
	}, [clearTerminalSession, isBusy, navigate, removeServer, server.directory, server.id, setIsBusy]);

	const handleRemoveServer = React.useCallback(async () => {
		if (isBusy || server.status === 'online') return;

		setIsBusy(true);
		try {
			clearTerminalSession();
			removeServer(server.id);
			toast.success(`Removed ${server.name} from mserve.`);
			navigate('/');
		} finally {
			setIsBusy(false);
		}
	}, [
		clearTerminalSession,
		isBusy,
		navigate,
		removeServer,
		server.id,
		server.name,
		server.status,
		setIsBusy,
	]);

	const visibleSections = React.useMemo(
		() => SERVER_SETTINGS_SECTIONS.filter((section) => matchesSection(section, query)),
		[query],
	);

	React.useEffect(() => {
		if (visibleSections.some((section) => section.id === activeSectionId)) {
			return;
		}

		setActiveSectionId(visibleSections[0]?.id ?? SERVER_SETTINGS_SECTIONS[0].id);
	}, [activeSectionId, visibleSections]);

	const activeSection = React.useMemo(
		() =>
			SERVER_SETTINGS_SECTIONS.find((section) => section.id === activeSectionId) ??
			SERVER_SETTINGS_SECTIONS[0],
		[activeSectionId],
	);
	const isNavigationLocked = isBusy;

	const sectionProps: SectionProps = {
		clearTerminalSession,
		server,
		javaRuntimes,
		isBusy,
		setIsBusy,
		syncServerContents,
		isLocked: isBusy || server.status !== 'offline',
		onManualSync: handleManualSync,
		onRemoveServer: handleRemoveServer,
		onDeleteServer: handleDelete,
	};

	return (
		<div className='grid h-full min-h-0 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]'>
			<div className='flex flex-1 flex-col'>
				<div className='relative'>
					<Search className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder='Search settings...'
						className='pl-9'
						disabled={isNavigationLocked}
					/>
				</div>

				<div
					aria-disabled={isNavigationLocked}
					className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden'>
					{visibleSections.length > 0 ? (
						visibleSections.map((section) => {
							const isActive = section.id === activeSection.id;

							return (
								<button
									key={section.id}
									type='button'
									onClick={() => setActiveSectionId(section.id)}
									disabled={isNavigationLocked}
									className={clsx(
										'flex w-[calc(100%-20px)] flex-col text-left transition-colors border-l-2 py-1 px-4 rounded-r-lg ml-5',
										isActive
											? 'border-accent bg-accent/25 text-foreground'
											: 'cursor-pointer text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground',
									)}>
									<span className='font-semibold'>{section.title}</span>
									{/* <span className='mt-1 text-xs leading-relaxed'>{section.description}</span> */}
								</button>
							);
						})
					) : (
						<div className='rounded-lg text-muted-foreground'>
							No categories match "{query.length > 8 ? query.slice(0, 8) + '...' : query}".
						</div>
					)}
				</div>
			</div>

			<div className='mb-6'>
				{visibleSections.length > 0 ? (
					<div className='app-scroll-area flex h-full min-h-0 flex-1 flex-col overflow-y-auto p-4 md:p-6'>
						{activeSection.render(sectionProps)}
					</div>
				) : (
					<div className='flex h-full min-h-0 items-center justify-center p-8 text-center text-sm text-muted-foreground'>
						No settings categories match the current search.
					</div>
				)}

				{sectionProps.isLocked && (
					<div className='absolute inset-0 z-10 flex items-center justify-center bg-background/70 p-6 text-center backdrop-blur-sm'>
						<div className='flex max-w-sm flex-col items-center gap-4 rounded-2xl border bg-background p-6 shadow-lg'>
							<Lock className='size-14 text-muted-foreground' />
							<p className='text-2xl font-bold'>Server must be offline to modify settings.</p>
							<p className='text-sm text-muted-foreground'>
								You can still inspect categories, but editing is disabled while the server is online
								or busy.
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
