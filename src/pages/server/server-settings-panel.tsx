import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Link2Off, Loader2, Lock, Search, Trash } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { toast } from 'sonner';

import {
	EditServerSettingsProvider,
	JavaSettingsSection,
	LocationSettingsSection,
	ProviderTelemetrySettingsSection,
	RamSettingsSection,
	RenameSettingsSection,
	ServerJarSettingsSection,
	StorageBackupsSettingsSection,
} from '@/components/edit-server-properties-form';
import ServerConfigFileEditor from '@/components/server-config-file-editor';
import { useUser } from '@/data/user';
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
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';
import {
	type ManagedConfigFileStatus,
	type ManagedServerConfigFileDefinition,
	type ManagedServerConfigFileKind,
	getManagedServerConfigFileDefinitions,
	getManagedServerConfigFileKeywords,
} from '@/lib/server-config-files';

type Props = {
	clearTerminalSession: () => void;
	server: Server;
	javaRuntimes: JavaRuntimeInfo[];
	isBusy: boolean;
	setIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
	syncServerContents: () => Promise<void>;
};

type FormSectionId =
	| 'rename'
	| 'performance'
	| 'storage-backups'
	| 'java'
	| 'provider-telemetry'
	| 'server-jar'
	| 'location';

type SectionId = FormSectionId | 'danger-zone' | ManagedServerConfigFileKind;

type SectionProps = Props & {
	isLocked: boolean;
	onRemoveServer: () => Promise<void>;
	onDeleteServer: () => Promise<void>;
	onConfigFilesChanged: () => Promise<void>;
};

type SectionConfig = {
	id: SectionId;
	title: string;
	description: string;
	keywords: string[];
	render: (props: SectionProps) => React.ReactNode;
};

// Granular "General" categories. Each renders a slice of the shared
// EditServerSettingsProvider so edits + the single save flow are shared.
const RENAME_SECTION: SectionConfig = {
	id: 'rename' as SectionId,
	title: 'General',
	description: 'Server name.',
	keywords: ['name', 'rename', 'title', 'general'],
	render: () => <RenameSettingsSection />,
};

const PERFORMANCE_SECTION: SectionConfig = {
	id: 'performance',
	title: 'Performance',
	description: 'Memory allocated to the server.',
	keywords: ['ram', 'memory', 'xmx', 'xms', 'performance', 'heap'],
	render: () => <RamSettingsSection />,
};

const STORAGE_BACKUPS_SECTION: SectionConfig = {
	id: 'storage-backups',
	title: 'Storage & Backups',
	description: 'Backup storage limit, auto-backups, and auto-restart.',
	keywords: ['storage', 'backup', 'backups', 'interval', 'auto restart', 'restart', 'gigabytes'],
	render: () => <StorageBackupsSettingsSection />,
};

const JAVA_SECTION: SectionConfig = {
	id: 'java',
	title: 'Java',
	description: 'Choose the JDK and Java flags for this server.',
	keywords: ['java', 'jdk', 'runtime', 'flags', 'nogui', 'installation'],
	render: () => <JavaSettingsSection />,
};

const PROVIDER_TELEMETRY_SECTION: SectionConfig = {
	id: 'provider-telemetry',
	title: 'Provider & Telemetry',
	description: 'Provider metadata and telemetry options.',
	keywords: ['provider', 'telemetry', 'tps', 'version', 'host', 'port', 'metadata'],
	render: () => <ProviderTelemetrySettingsSection />,
};

const SERVER_JAR_SECTION: SectionConfig = {
	id: 'server-jar',
	title: 'Server Jar',
	description: 'Sync mserve.json and update or swap the server jar.',
	keywords: ['jar', 'sync', 'mserve.json', 'download', 'swap', 'update', 'build'],
	render: () => <ServerJarSettingsSection />,
};

const LOCATION_SECTION: SectionConfig = {
	id: 'location',
	title: 'Location',
	description: 'Move the server to a new directory.',
	keywords: ['move', 'location', 'directory', 'path', 'folder'],
	render: () => <LocationSettingsSection />,
};

const DANGER_ZONE_SECTION: SectionConfig = {
	id: 'danger-zone',
	title: 'Danger Zone',
	description: 'Remove the server from mserve or delete it entirely.',
	keywords: ['delete', 'remove', 'trash', 'danger', 'recycle', 'wipe', 'destroy'],
	render: (props) => <DangerZoneSection {...props} />,
};

const getConfigFileSection = (definition: ManagedServerConfigFileDefinition): SectionConfig => ({
	id: definition.kind,
	title: definition.title,
	description: definition.description,
	keywords: getManagedServerConfigFileKeywords(definition),
	render: (props) => (
		<ServerConfigFileEditor
			serverDirectory={props.server.directory}
			definition={definition}
			disabled={props.isLocked}
			onSaved={props.onConfigFilesChanged}
		/>
	),
});

const managedConfigFileStatusCache = new Map<string, ManagedConfigFileStatus[]>();

const normalizeQuery = (value: string) => value.trim().toLowerCase();

const matchesSection = (section: SectionConfig, query: string) => {
	const normalized = normalizeQuery(query);
	if (!normalized) return true;

	return [section.title, section.description, ...section.keywords]
		.join(' ')
		.toLowerCase()
		.includes(normalized);
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
									This will remove the server from the MSERVE app. It will lose the data associated with
									the app. However, it will NOT delete any files and it will NOT remove mserve.json. You
									can always import the server again.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction variant='destructive' onClick={onRemoveServer} className='capitalize'>
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
	const { hash } = useLocation();
	const { removeServer, updateServer } = useServers();
	const { user } = useUser();
	const [query, setQuery] = React.useState('');
	const [activeSectionId, setActiveSectionId] = React.useState<SectionId>(
		() => (hash.slice(1) as SectionId) || 'rename',
	);
	const cacheKey = React.useMemo(() => server.directory.trim().toLowerCase(), [server.directory]);
	const [managedConfigFileStatuses, setManagedConfigFileStatuses] = React.useState<ManagedConfigFileStatus[]>(
		[],
	);
	const [isScanningConfigFiles, setIsScanningConfigFiles] = React.useState(false);
	const providerKind = React.useMemo(
		() => getServerProviderCapabilities(server.provider).kind,
		[server.provider],
	);
	const managedConfigFileDefinitions = React.useMemo(
		() => getManagedServerConfigFileDefinitions(providerKind),
		[providerKind],
	);

	const refreshManagedConfigFiles = React.useCallback(async () => {
		setIsScanningConfigFiles(true);
		try {
			const files = await invoke<ManagedConfigFileStatus[]>('scan_managed_server_config_files', {
				directory: server.directory,
			});
			managedConfigFileStatusCache.set(cacheKey, files);
			setManagedConfigFileStatuses(files);
		} catch {
			managedConfigFileStatusCache.delete(cacheKey);
			setManagedConfigFileStatuses([]);
		} finally {
			setIsScanningConfigFiles(false);
		}
	}, [cacheKey, server.directory]);

	React.useEffect(() => {
		const cachedStatuses = managedConfigFileStatusCache.get(cacheKey);
		if (cachedStatuses) {
			setManagedConfigFileStatuses(cachedStatuses);
			return;
		}

		void refreshManagedConfigFiles();
	}, [cacheKey, refreshManagedConfigFiles]);

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

	const baseSections = React.useMemo(() => {
		const sections: SectionConfig[] = [
			RENAME_SECTION,
			PERFORMANCE_SECTION,
			STORAGE_BACKUPS_SECTION,
			JAVA_SECTION,
			PROVIDER_TELEMETRY_SECTION,
			SERVER_JAR_SECTION,
		];
		if (user.advanced_mode) {
			sections.push(LOCATION_SECTION);
		}
		return sections;
	}, [user.advanced_mode]);

	const visibleManagedConfigDefinitions = React.useMemo(() => {
		const statusMap = new Map(managedConfigFileStatuses.map((entry) => [entry.fileName, entry.exists]));
		return managedConfigFileDefinitions.filter((definition) => {
			if (!statusMap.get(definition.fileName)) {
				return false;
			}

			if (definition.format === 'yaml' && !user.advanced_mode) {
				return false;
			}

			return true;
		});
	}, [managedConfigFileDefinitions, managedConfigFileStatuses, user.advanced_mode]);

	const configFileSections = React.useMemo(
		() => visibleManagedConfigDefinitions.map(getConfigFileSection),
		[visibleManagedConfigDefinitions],
	);

	const allSections = React.useMemo(
		() => [...baseSections, ...configFileSections, DANGER_ZONE_SECTION],
		[baseSections, configFileSections],
	);

	const visibleBaseSections = React.useMemo(
		() => baseSections.filter((section) => matchesSection(section, query)),
		[baseSections, query],
	);
	const visibleConfigFileSections = React.useMemo(
		() => configFileSections.filter((section) => matchesSection(section, query)),
		[configFileSections, query],
	);
	const isDangerVisible = matchesSection(DANGER_ZONE_SECTION, query);

	const orderedVisibleSections = React.useMemo(
		() => [
			...visibleBaseSections,
			...visibleConfigFileSections,
			...(isDangerVisible ? [DANGER_ZONE_SECTION] : []),
		],
		[isDangerVisible, visibleBaseSections, visibleConfigFileSections],
	);

	React.useEffect(() => {
		if (orderedVisibleSections.some((section) => section.id === activeSectionId)) {
			return;
		}

		setActiveSectionId(orderedVisibleSections[0]?.id ?? RENAME_SECTION.id);
	}, [activeSectionId, orderedVisibleSections]);

	const activeSection = React.useMemo(
		() => allSections.find((section) => section.id === activeSectionId) ?? PERFORMANCE_SECTION,
		[activeSectionId, allSections],
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
		onRemoveServer: handleRemoveServer,
		onDeleteServer: handleDelete,
		onConfigFilesChanged: refreshManagedConfigFiles,
	};

	const hasVisibleSections = orderedVisibleSections.length > 0;
	// Only show the loading row on the very first scan; later refreshes (e.g. after
	// saving a config file) keep the list visible to avoid a collapse/flicker.
	const showConfigFileLoading = isScanningConfigFiles && managedConfigFileStatuses.length === 0;

	const renderSectionButton = (section: SectionConfig) => {
		const isActive = section.id === activeSection.id;
		return (
			<button
				key={section.id}
				type='button'
				onClick={() => setActiveSectionId(section.id)}
				disabled={isNavigationLocked}
				className={clsx(
					'flex w-[calc(100%-8px)] flex-col text-left transition-colors border-l-2 py-1 px-4 rounded-r-lg ml-2',
					isActive
						? 'border-accent bg-accent/25 text-foreground'
						: 'cursor-pointer text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground',
				)}>
				<span className='font-semibold'>{section.title}</span>
			</button>
		);
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
					{hasVisibleSections ? (
						<>
							{visibleBaseSections.map(renderSectionButton)}

							{showConfigFileLoading ? (
								<div className='ml-2 flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground'>
									<Loader2 className='size-4 animate-spin' />
									<span>Detecting config files...</span>
								</div>
							) : (
								<AnimatePresence initial>
									{visibleConfigFileSections.map((section, index) => (
										<m.div
											key={section.id}
											initial={{ height: 0, opacity: 0 }}
											animate={{ height: 'auto', opacity: 1 }}
											exit={{ height: 0, opacity: 0 }}
											transition={{
												type: 'spring',
												duration: 0.25,
												bounce: 0,
												delay: index * 0.06,
											}}
											className='overflow-hidden'>
											{renderSectionButton(section)}
										</m.div>
									))}
								</AnimatePresence>
							)}

							{isDangerVisible && renderSectionButton(DANGER_ZONE_SECTION)}
						</>
					) : (
						<div className='rounded-lg text-muted-foreground'>
							No categories match "{query.length > 8 ? query.slice(0, 8) + '...' : query}".
						</div>
					)}
				</div>
			</div>

			<div className='mb-6 relative'>
				<EditServerSettingsProvider
					server={server}
					javaRuntimes={javaRuntimes}
					disabled={isBusy}
					onSaved={syncServerContents}
					onManualSync={handleManualSync}>
					{hasVisibleSections ? (
						<div className='app-scroll-area flex h-full min-h-0 flex-1 flex-col overflow-y-auto p-4 md:p-6'>
							{activeSection.render(sectionProps)}
						</div>
					) : (
						<div className='flex h-full min-h-0 items-center justify-center p-8 text-center text-sm text-muted-foreground'>
							No settings categories match the current search.
						</div>
					)}
				</EditServerSettingsProvider>

				{sectionProps.isLocked && (
					<div className='absolute top-0 z-10 flex items-center justify-center bg-background/70 p-6 text-center w-full'>
						<div className='flex flex-col items-center text-center max-w-lg'>
							<Lock className='size-20 mb-6' />
							<p className='text-2xl font-bold flex gap-5 items-center mb-2 w-fit backdrop-blur-[1px]'>
								Server must be offline to modify settings.
							</p>
							<p className='text-sm text-muted-foreground backdrop-blur-[2px]'>
								You can still inspect categories, but editing is disabled while the server is online or
								busy.
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
