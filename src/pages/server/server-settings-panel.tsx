import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { Link2Off, Lock, Trash } from 'lucide-react';
import { toast } from 'sonner';

import {
	EditServerSettingsProvider,
	JavaSettingsSection,
	LocationSettingsSection,
	ProviderTelemetrySettingsSection,
	GeneralSettingsSection,
	SleepModeSettingsSection,
} from '@/components/edit-server-settings-form';
import SecuritySettingsSection from './security/security-settings-section';
import ServerConfigFileEditor from '@/components/server-config-file-editor';
import { TunnelSettingsSection } from './tunnel-settings-section';
import { HelpButton } from '@/components/help/help-button';
import { type SettingsGroup, type SettingsSection, SettingsLayout } from '@/components/settings/settings-layout';
import { SettingsRow, SettingsRows } from '@/components/settings/settings-row';
import { isExperienceAtLeast, useExperience } from '@/data/user';
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
import { isStoppedStatus, Server, useServers } from '@/data/servers';
import type { JavaRuntimeInfo } from '@/lib/java-runtime-service';
import { syncMserveJsonWithRepair } from '@/lib/mserve-sync';
import { mapSyncedConfigToServer } from '@/lib/mserve-server-mapper';
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';
import {
	type ManagedConfigFileStatus,
	type ManagedServerConfigFileDefinition,
	type ManagedServerConfigFileKind,
	getManagedServerConfigFileDefinitions,
	getManagedServerConfigFileKeywords,
	isConfigFileVisibleAtLevel,
} from '@/lib/server-config-files';
import { getErrorMessage } from '@/lib/utils';

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
	| 'java'
	| 'sleep'
	| 'security'
	| 'provider-telemetry'
	| 'tunnel'
	| 'location';

type SectionId = FormSectionId | 'danger-zone' | ManagedServerConfigFileKind;

type SectionProps = Props & {
	isLocked: boolean;
	onRemoveServer: () => Promise<void>;
	onDeleteServer: () => Promise<void>;
	onConfigFilesChanged: () => Promise<void>;
};

type GroupId = 'server' | 'config-files' | 'danger';

type SectionConfig = Omit<SettingsSection, 'id' | 'group' | 'render'> & {
	id: SectionId;
	group: GroupId;
	render: (props: SectionProps) => React.ReactNode;
};

// Granular "General" categories. Each renders a slice of the shared
// EditServerSettingsProvider so edits + the single save flow are shared.
const GENERAL_SECTION: SectionConfig = {
	id: 'rename',
	group: 'server',
	title: 'General',
	description: 'Name, memory, and crash recovery for this server.',
	keywords: [
		'name',
		'rename',
		'title',
		'general',
		'ram',
		'memory',
		'xmx',
		'xms',
		'performance',
		'heap',
		'auto restart',
		'crash',
		'sync',
		'mserve.json',
	],
	render: () => <GeneralSettingsSection />,
};

const SLEEP_SECTION: SectionConfig = {
	id: 'sleep',
	group: 'server',
	title: 'Sleep Mode',
	description: 'Sleep an idle server and wake it automatically when a player joins.',
	keywords: ['sleep', 'idle', 'wake', 'lazymc', 'power', 'motd', 'afk', 'auto stop', 'hibernate'],
	render: () => <SleepModeSettingsSection />,
};

const SECURITY_SECTION: SectionConfig = {
	id: 'security',
	group: 'server',
	title: 'Security',
	description: 'A quick audit of this server’s exposure and bot-attack surface, with one-click hardening.',
	keywords: [
		'security',
		'bot',
		'ddos',
		'whitelist',
		'online mode',
		'rcon',
		'protection',
		'audit',
		'anti-bot',
		'antibot',
		'harden',
		'exploit',
	],
	render: (props) => (
		<SecuritySettingsSection server={props.server} onContentChanged={props.syncServerContents} />
	),
};

const JAVA_SECTION: SectionConfig = {
	id: 'java',
	group: 'server',
	title: 'Java',
	description: 'The Java runtime and server jar this server runs on.',
	keywords: [
		'java',
		'jdk',
		'runtime',
		'flags',
		'nogui',
		'installation',
		'jar',
		'download',
		'swap',
		'update',
		'build',
	],
	render: () => <JavaSettingsSection />,
};

const PROVIDER_TELEMETRY_SECTION: SectionConfig = {
	id: 'provider-telemetry',
	group: 'server',
	title: 'Provider & Telemetry',
	description: 'Provider metadata and which telemetry mserve collects.',
	keywords: ['provider', 'telemetry', 'tps', 'version', 'host', 'port', 'metadata'],
	render: () => <ProviderTelemetrySettingsSection />,
};

const TUNNEL_SECTION: SectionConfig = {
	id: 'tunnel',
	group: 'server',
	title: 'Tunnel',
	titleAddon: <HelpButton topic='tunneling' />,
	description:
		'Make this server reachable from anywhere over the internet (no port forwarding) using a free, persistent playit.gg address.',
	keywords: [
		'tunnel',
		'playit',
		'public',
		'internet',
		'expose',
		'claim',
		'address',
		'port forward',
		'external',
		'remote',
	],
	render: (props) => <TunnelSettingsSection server={props.server} />,
};

const LOCATION_SECTION: SectionConfig = {
	id: 'location',
	group: 'server',
	title: 'Location',
	description: 'Move the server to a new directory.',
	keywords: ['move', 'location', 'directory', 'path', 'folder'],
	render: () => <LocationSettingsSection />,
};

const DANGER_ZONE_SECTION: SectionConfig = {
	id: 'danger-zone',
	group: 'danger',
	title: 'Danger Zone',
	tone: 'destructive',
	description: 'Remove the server from mserve or send its files to the recycle bin.',
	keywords: ['delete', 'remove', 'trash', 'danger', 'recycle', 'wipe', 'destroy'],
	render: (props) => <DangerZoneSection {...props} />,
};

// Sections that must be locked while the server is not offline. Config file sections
// not listed here (ops.json, whitelist.json, ban lists, help.yml, commands.yml) are
// intentionally editable while the server is running.
const LOCKED_SECTION_IDS: ReadonlySet<SectionId> = new Set<SectionId>([
	'rename',
	'java',
	'provider-telemetry',
	'location',
	'server-properties',
	'bukkit-yml',
	'spigot-yml',
	'velocity-toml',
	'danger-zone',
]);

const getConfigFileSection = (definition: ManagedServerConfigFileDefinition): SectionConfig => ({
	id: definition.kind,
	group: 'config-files',
	title: definition.title,
	description: definition.description,
	keywords: getManagedServerConfigFileKeywords(definition),
	render: (props) => (
		<ServerConfigFileEditor
			serverDirectory={props.server.directory}
			definition={definition}
			disabled={props.isLocked && LOCKED_SECTION_IDS.has(definition.kind)}
			onSaved={props.onConfigFilesChanged}
		/>
	),
});

const managedConfigFileStatusCache = new Map<string, ManagedConfigFileStatus[]>();

const DangerZoneSection: React.FC<SectionProps> = ({ server, isBusy, onRemoveServer, onDeleteServer }) => {
	const disabled = isBusy || !isStoppedStatus(server.status);

	return (
		<SettingsRows>
			<SettingsRow
				title='Remove from mserve'
				description='Forget this server in mserve. Its files and mserve.json stay on disk, so you can import it again later.'
				control={
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
								<AlertDialogAction variant='destructive' onClick={onRemoveServer} className='capitalize'>
									Remove Server
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				}
			/>

			<SettingsRow
				title='Delete server'
				tone='destructive'
				description='Move the whole server folder, including worlds and backups, to the recycle bin.'
				control={
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
								<AlertDialogAction variant='destructive' className='capitalize' onClick={onDeleteServer}>
									Delete Server
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				}
			/>
		</SettingsRows>
	);
};

const LockedNotice: React.FC = () => (
	<div className='flex flex-col items-center px-6 pt-6 text-center'>
		<Lock className='mb-6 size-20' />
		<p className='mb-2 w-fit text-2xl font-bold backdrop-blur-[1px]'>
			Server must be offline to modify settings.
		</p>
		<p className='max-w-lg text-sm text-muted-foreground backdrop-blur-[2px]'>
			You can still inspect categories, but editing is disabled while the server is online or busy.
		</p>
	</div>
);

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
	const experienceLevel = useExperience().level;
	const cacheKey = React.useMemo(() => server.directory.trim().toLowerCase(), [server.directory]);
	const [managedConfigFileStatuses, setManagedConfigFileStatuses] = React.useState<
		ManagedConfigFileStatus[]
	>([]);
	const [isScanningConfigFiles, setIsScanningConfigFiles] = React.useState(false);
	const providerKind = React.useMemo(
		() => getServerProviderCapabilities(server.provider).kind,
		[server.provider],
	);
	const providerName = server.provider.name;
	const managedConfigFileDefinitions = React.useMemo(
		() => getManagedServerConfigFileDefinitions(providerKind, providerName),
		[providerKind, providerName],
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

	// Show the last known list at once, but rescan on every visit: a server's
	// first start writes files (bukkit.yml, spigot.yml…) that weren't there.
	React.useEffect(() => {
		const cachedStatuses = managedConfigFileStatusCache.get(cacheKey);
		if (cachedStatuses) {
			setManagedConfigFileStatuses(cachedStatuses);
		}

		void refreshManagedConfigFiles();
	}, [cacheKey, refreshManagedConfigFiles]);

	const handleManualSync = React.useCallback(async () => {
		if (isBusy || !isStoppedStatus(server.status)) return;

		setIsBusy(true);
		try {
			const synced = await syncMserveJsonWithRepair(server.directory, () => server);
			if (!synced) {
				toast.error('Sync cancelled. mserve.json rebuild was not completed.');
				return;
			}

			updateServer(server.id, mapSyncedConfigToServer(synced.config));

			toast.success(synced.message);
		} catch (err) {
			const message = getErrorMessage(err, 'Failed to sync mserve.json.');
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
			const message = getErrorMessage(err, 'Failed to delete server.');
			toast.error(message);
		} finally {
			setIsBusy(false);
		}
	}, [clearTerminalSession, isBusy, navigate, removeServer, server.directory, server.id, setIsBusy]);

	const handleRemoveServer = React.useCallback(async () => {
		if (isBusy || !isStoppedStatus(server.status)) return;

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
		const sections: SectionConfig[] = [GENERAL_SECTION, JAVA_SECTION];
		// Sleep mode wakes a server from its own port and the security audit reads
		// server.properties; proxies (velocity.toml, member orchestration) get
		// neither in v1.
		if (providerKind !== 'proxy') {
			sections.push(SLEEP_SECTION, SECURITY_SECTION);
		}
		if (isExperienceAtLeast(experienceLevel, 'standard')) {
			sections.push(PROVIDER_TELEMETRY_SECTION);
		}
		sections.push(TUNNEL_SECTION);
		if (experienceLevel === 'advanced') {
			sections.push(LOCATION_SECTION);
		}
		return sections;
	}, [providerKind, experienceLevel]);

	const configFileSections = React.useMemo(() => {
		const statusMap = new Map(managedConfigFileStatuses.map((entry) => [entry.fileName, entry.exists]));
		return managedConfigFileDefinitions
			.filter(
				(definition) =>
					statusMap.get(definition.fileName) && isConfigFileVisibleAtLevel(definition, experienceLevel),
			)
			.map(getConfigFileSection);
	}, [managedConfigFileDefinitions, managedConfigFileStatuses, experienceLevel]);

	const isLocked = isBusy || !isStoppedStatus(server.status);
	const sectionProps: SectionProps = {
		clearTerminalSession,
		server,
		javaRuntimes,
		isBusy,
		setIsBusy,
		syncServerContents,
		isLocked,
		onRemoveServer: handleRemoveServer,
		onDeleteServer: handleDelete,
		onConfigFilesChanged: refreshManagedConfigFiles,
	};

	const sections: SettingsSection[] = [...baseSections, ...configFileSections, DANGER_ZONE_SECTION].map(
		(section) => ({ ...section, render: () => section.render(sectionProps) }),
	);

	// Only show the loading row on the very first scan; later refreshes (e.g. after
	// saving a config file) keep the list visible to avoid a collapse/flicker.
	const showConfigFileLoading = isScanningConfigFiles && managedConfigFileStatuses.length === 0;
	const groups: SettingsGroup[] = [
		{ id: 'server', title: 'Server' },
		{
			id: 'config-files',
			title: 'Config files',
			loadingLabel: showConfigFileLoading ? 'Detecting config files...' : undefined,
		},
		{ id: 'danger' },
	];

	return (
		<EditServerSettingsProvider
			server={server}
			javaRuntimes={javaRuntimes}
			disabled={isBusy}
			onSaved={syncServerContents}
			onManualSync={handleManualSync}>
			<SettingsLayout
				groups={groups}
				sections={sections}
				navigationDisabled={isBusy}
				renderOverlay={(section) =>
					isLocked && LOCKED_SECTION_IDS.has(section.id as SectionId) ? <LockedNotice /> : null
				}
			/>
		</EditServerSettingsProvider>
	);
}
