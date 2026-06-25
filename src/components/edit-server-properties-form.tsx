import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Download, FolderOpen, Info, Loader, RefreshCcw, Save, Trash } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { type Server, useServers } from '@/data/servers';
import { useUser } from '@/data/user';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TELEMETRY_POLLING } from '@/lib/mserve-consts';
import { type Provider, type TelemetryKey } from '@/lib/mserve-schema';
import { getDefaultProviderCommandSupport } from '@/lib/server-provider-capabilities';
import {
	createProvider,
	getProviderDisplayName,
	isProxyProvider,
	isServerProvider,
	PROVIDER_NAMES,
} from '@/lib/server-provider';
import { type JavaRuntimeInfo } from '@/lib/java-runtime-service';
import { javaResolutionLabel, resolveServerJavaExecutable } from '@/lib/java-resolution';
import { clampRamGb } from '@/lib/ram-utils';
import { getServerNameFromDirectory } from '@/lib/mserve-server-mapper';
import { backupChoices } from '@/pages/server/server-constants';
import {
	buildServerRunCommandPreview,
	buildUpdateServerSettingsPayload,
	formatCustomFlagsInput,
	parseCustomFlagsInput,
	resolveNewDirectory,
	toggleBackupMode,
} from '@/pages/server/server-utils';
import type { ServerSettingsForm, UpdateServerSettingsResult } from '@/pages/server/server-types';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group';
import RamSelector from './ram-selector';
import JavaRuntimeSelect from './java-runtime-select';
import JarDownloadModal, {
	type DownloadedJarSelection,
} from '@/pages/create-server/slides/components/JarDownloadModal';
import ServerJarUpdateSection from '@/components/server-jar-update-section';

const TELEMETRY_LABELS: Record<TelemetryKey, string> = {
	list: 'Players list polling',
	tps: 'TPS polling',
	version: 'Version polling',
	online: 'Online status polling',
	ram: 'RAM metrics',
	cpu: 'CPU metrics',
	provider: 'Provider version telemetry',
};

const sameStringList = (left: string[], right: string[]) => {
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
};

const sameProvider = (left: Provider, right: Provider) => JSON.stringify(left) === JSON.stringify(right);

const parseJdkVersions = (value: string): number[] =>
	Array.from(
		new Set(
			value
				.split(',')
				.map((token) => Number(token.trim()))
				.filter((token) => Number.isInteger(token) && token > 0),
		),
	);

const buildFormFromServer = (server: Server): ServerSettingsForm => ({
	ram: clampRamGb(server.ram),
	storage_limit: Math.max(1, Number(server.storage_limit) || 200),
	auto_backup: server.auto_backup,
	auto_backup_interval: Math.max(1, server.auto_backup_interval),
	auto_restart: server.auto_restart,
	custom_flags: server.custom_flags,
	java_installation: server.java_installation ?? '',
	provider: createProvider(server.provider, { file: server.file }),
	telemetry_host: server.telemetry_host ?? '127.0.0.1',
	telemetry_port: Math.max(1, Number(server.telemetry_port) || 25565),
	jar_swap_path: '',
	new_directory: server.directory,
});

type EditServerSettingsContextValue = {
	server: Server;
	javaRuntimes: JavaRuntimeInfo[];
	advancedMode: boolean;
	globalJavaDefault: string;
	settingsForm: ServerSettingsForm;
	customFlagsDraft: string;
	setCustomFlagsDraft: React.Dispatch<React.SetStateAction<string>>;
	jdkVersionsDraft: string;
	setJdkVersionsDraft: React.Dispatch<React.SetStateAction<string>>;
	isJarModalOpen: boolean;
	setIsJarModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
	updateSettingsField: <K extends keyof ServerSettingsForm>(key: K, value: ServerSettingsForm[K]) => void;
	updateProvider: (updater: (provider: Provider) => Provider) => void;
	toggleSettingsBackupMode: (mode: (typeof backupChoices)[number]['value'], enabled: boolean) => void;
	toggleSupportedTelemetry: (key: TelemetryKey, enabled: boolean) => void;
	handleProviderJarDownloaded: (selection: DownloadedJarSelection) => void;
	pickSwapJarFile: () => Promise<void>;
	pickNewDirectory: () => Promise<void>;
	providerCommandSupport: ReturnType<typeof getDefaultProviderCommandSupport>;
	runCommandPreview: string;
	effectiveJavaRuntimeLabel: string | null;
	settingsError: string | null;
	isFormLocked: boolean;
	isSaving: boolean;
	isOffline: boolean;
	onManualSync?: () => void;
	handleSaveBackupSettings: () => Promise<void>;
};

const EditServerSettingsContext = React.createContext<EditServerSettingsContextValue | null>(null);

export const useEditServerSettings = (): EditServerSettingsContextValue => {
	const context = React.useContext(EditServerSettingsContext);
	if (!context) {
		throw new Error('useEditServerSettings must be used within an EditServerSettingsProvider.');
	}
	return context;
};

type EditServerSettingsProviderProps = {
	server: Server;
	javaRuntimes: JavaRuntimeInfo[];
	disabled?: boolean;
	onSaved?: () => Promise<void> | void;
	onManualSync?: () => void;
	children: React.ReactNode;
};

export const EditServerSettingsProvider: React.FC<EditServerSettingsProviderProps> = ({
	server,
	javaRuntimes,
	disabled,
	onSaved,
	onManualSync,
	children,
}) => {
	const { updateServer } = useServers();
	const { user } = useUser();
	const [isSaving, setIsSaving] = React.useState(false);
	const [settingsError, setSettingsError] = React.useState<string | null>(null);
	const [customFlagsDraft, setCustomFlagsDraft] = React.useState('');
	const [jdkVersionsDraft, setJdkVersionsDraft] = React.useState('21');
	const [isJarModalOpen, setIsJarModalOpen] = React.useState(false);
	const [settingsForm, setSettingsForm] = React.useState<ServerSettingsForm>(() =>
		buildFormFromServer(server),
	);

	const serverId = server.id;
	const unsavedToastId = React.useMemo(() => `server-settings-unsaved-${serverId}`, [serverId]);
	const providerCommandSupport = React.useMemo(
		() => getDefaultProviderCommandSupport(settingsForm.provider.name),
		[settingsForm.provider.name],
	);
	const isFormLocked = Boolean(disabled || isSaving || server.status !== 'offline');
	const isOffline = server.status === 'offline';

	const hasUnsavedChanges = React.useMemo(() => {
		// When online, backup settings are saved via their own inline button — the
		// global unsaved-changes toast only applies to offline-only settings.
		if (server.status !== 'offline') return false;
		if (settingsForm.ram !== clampRamGb(server.ram)) return true;
		if (settingsForm.storage_limit !== Math.max(1, Number(server.storage_limit) || 200)) return true;
		if (settingsForm.auto_backup_interval !== Math.max(1, server.auto_backup_interval)) return true;
		if (settingsForm.auto_restart !== server.auto_restart) return true;
		if (!sameStringList(settingsForm.auto_backup, server.auto_backup)) return true;
		if (!sameStringList(settingsForm.custom_flags, server.custom_flags)) return true;
		if ((settingsForm.java_installation || '').trim() !== (server.java_installation || '').trim()) {
			return true;
		}
		if (!sameProvider(settingsForm.provider, server.provider)) return true;
		if ((settingsForm.telemetry_host || '').trim() !== (server.telemetry_host || '').trim()) return true;
		if (Number(settingsForm.telemetry_port) !== Number(server.telemetry_port || 25565)) return true;
		if (settingsForm.jar_swap_path.trim().length > 0) return true;
		if (settingsForm.new_directory.trim() !== server.directory.trim()) return true;

		return false;
	}, [
		server.auto_backup,
		server.auto_backup_interval,
		server.auto_restart,
		server.custom_flags,
		server.directory,
		server.java_installation,
		server.provider,
		server.ram,
		server.status,
		server.storage_limit,
		server.telemetry_host,
		server.telemetry_port,
		settingsForm,
	]);

	React.useEffect(() => {
		const provider = createProvider(server.provider, { file: server.file });
		setSettingsForm(buildFormFromServer(server));
		setCustomFlagsDraft(formatCustomFlagsInput(server.custom_flags));
		setJdkVersionsDraft(provider.jdk_versions.join(', '));
		setSettingsError(null);
	}, [
		server.auto_backup,
		server.auto_backup_interval,
		server.auto_restart,
		server.custom_flags,
		server.directory,
		server.file,
		server.java_installation,
		server.provider,
		server.ram,
		server.storage_limit,
		server.telemetry_host,
		server.telemetry_port,
	]);

	React.useEffect(() => {
		return () => {
			toast.dismiss(unsavedToastId);
		};
	}, [unsavedToastId]);

	const updateSettingsField = React.useCallback(
		<K extends keyof ServerSettingsForm>(key: K, value: ServerSettingsForm[K]) => {
			setSettingsForm((prev) => ({ ...prev, [key]: value }));
		},
		[],
	);

	const updateProvider = React.useCallback((updater: (provider: Provider) => Provider) => {
		setSettingsForm((prev) => ({
			...prev,
			provider: updater(prev.provider),
		}));
	}, []);

	const toggleSettingsBackupMode = React.useCallback(
		(mode: (typeof backupChoices)[number]['value'], enabled: boolean) => {
			setSettingsForm((prev) => ({
				...prev,
				auto_backup: toggleBackupMode(prev.auto_backup, mode, enabled),
			}));
		},
		[],
	);

	const toggleSupportedTelemetry = React.useCallback(
		(key: TelemetryKey, enabled: boolean) => {
			updateProvider((provider) => {
				const next = new Set(provider.supported_telemetry);
				if (enabled) {
					next.add(key);
				} else {
					next.delete(key);
				}
				return {
					...provider,
					supported_telemetry: Array.from(next),
				};
			});
		},
		[updateProvider],
	);

	const pickSwapJarFile = React.useCallback(async () => {
		try {
			const selected = await openDialog({
				directory: false,
				multiple: false,
				filters: [{ extensions: ['jar'], name: 'Jar Files' }],
				title: 'Choose jar file to swap with server jar',
			});

			if (typeof selected === 'string') {
				updateSettingsField('jar_swap_path', selected);
				setSettingsError(null);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Could not open file picker.';
			setSettingsError(message);
		}
	}, [updateSettingsField]);

	const handleProviderJarDownloaded = React.useCallback(
		(selection: DownloadedJarSelection) => {
			// The downloaded jar is swapped into the server directory, which keeps
			// the existing jar filename — only the contents and provider metadata
			// (version, jdk, stability, …) change.
			updateSettingsField('jar_swap_path', selection.filePath);
			updateProvider((prev) => ({ ...selection.provider, file: prev.file }));
			setJdkVersionsDraft(selection.provider.jdk_versions.join(', '));
			setSettingsError(null);
			toast.success(`Selected ${selection.selectionLabel}. Save to apply the update.`);
		},
		[updateProvider, updateSettingsField],
	);

	const pickNewDirectory = React.useCallback(async () => {
		try {
			const selected = await openDialog({
				directory: true,
				multiple: false,
				title: 'Choose new server directory location',
			});

			if (typeof selected === 'string') {
				updateSettingsField('new_directory', selected);
				setSettingsError(null);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Could not open directory picker.';
			setSettingsError(message);
		}
	}, [updateSettingsField]);

	const handleResetSettingsForm = React.useCallback(() => {
		const provider = createProvider(server.provider, { file: server.file });
		setSettingsForm(buildFormFromServer(server));
		setCustomFlagsDraft(formatCustomFlagsInput(server.custom_flags));
		setJdkVersionsDraft(provider.jdk_versions.join(', '));
		setSettingsError(null);
		toast.dismiss(unsavedToastId);
	}, [server, unsavedToastId]);

	const handleSaveSettings = React.useCallback(async () => {
		if (isFormLocked) return;

		// Automatic stays automatic (empty java_installation). The runtime is
		// resolved at start time from the live compatibility matrix + detected
		// runtimes, so there's no need to bake a path in here.
		const payload = buildUpdateServerSettingsPayload(server.directory, settingsForm);
		payload.new_directory = resolveNewDirectory(payload, server.directory);

		setSettingsError(null);
		setIsSaving(true);
		try {
			const savePromise = invoke<UpdateServerSettingsResult>('update_server_settings', { payload });
			toast.promise(savePromise, {
				loading: 'Saving server settings...',
				success: 'Server settings updated',
				error: (err) => (err instanceof Error ? err.message : 'Failed to update server settings.'),
			});
			const result = await savePromise;

			updateServer(serverId, {
				directory: result.directory,
				name: getServerNameFromDirectory(result.directory),
				file: result.file,
				ram: payload.ram,
				storage_limit: payload.storage_limit,
				auto_backup: payload.auto_backup,
				auto_backup_interval: payload.auto_backup_interval,
				auto_restart: payload.auto_restart,
				java_installation: payload.java_installation,
				custom_flags: payload.custom_flags,
				provider: createProvider(result.provider, { file: result.file }),
				telemetry_host: result.telemetry_host,
				telemetry_port: result.telemetry_port,
			});

			setSettingsForm((prev) => ({
				...prev,
				jar_swap_path: '',
				new_directory: result.directory,
			}));
			toast.dismiss(unsavedToastId);
			await onSaved?.();
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to update server settings.';
			setSettingsError(message);
		} finally {
			setIsSaving(false);
		}
	}, [
		isFormLocked,
		javaRuntimes,
		onSaved,
		server.directory,
		serverId,
		settingsForm,
		unsavedToastId,
		updateServer,
		user.java_installation_default,
	]);

	const handleSaveBackupSettings = React.useCallback(async () => {
		if (isSaving) return;
		setIsSaving(true);
		try {
			await invoke('update_server_backup_settings', {
				directory: server.directory,
				storageLimit: settingsForm.storage_limit,
				autoBackup: settingsForm.auto_backup,
				autoBackupInterval: settingsForm.auto_backup_interval,
				autoRestart: settingsForm.auto_restart,
			});
			updateServer(serverId, {
				storage_limit: settingsForm.storage_limit,
				auto_backup: settingsForm.auto_backup,
				auto_backup_interval: settingsForm.auto_backup_interval,
				auto_restart: settingsForm.auto_restart,
			});
			toast.success('Backup settings saved.');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to save backup settings.';
			toast.error(message);
		} finally {
			setIsSaving(false);
		}
	}, [
		isSaving,
		server.directory,
		serverId,
		settingsForm.auto_backup,
		settingsForm.auto_backup_interval,
		settingsForm.auto_restart,
		settingsForm.storage_limit,
		updateServer,
	]);

	React.useEffect(() => {
		if (isFormLocked || !hasUnsavedChanges) {
			toast.dismiss(unsavedToastId);
			return;
		}

		toast('You have unsaved changes', {
			id: unsavedToastId,
			duration: Number.POSITIVE_INFINITY,
			dismissible: false,
			style: {
				'--width': 'min(32rem, calc(100vw - 2rem))',
			} as React.CSSProperties,
			action: (
				<div className='ml-auto flex items-center gap-2'>
					<Button type='button' variant='destructive-secondary' onClick={handleResetSettingsForm}>
						<Trash className='size-4' /> Reset
					</Button>
					<Button type='button' onClick={handleSaveSettings}>
						{isSaving ? <Loader className='animate-spin size-4' /> : <Save className='size-4' />}
						{isSaving ? 'Saving...' : 'Save properties'}
					</Button>
				</div>
			),
		});
	}, [
		handleResetSettingsForm,
		handleSaveSettings,
		hasUnsavedChanges,
		isFormLocked,
		isSaving,
		unsavedToastId,
	]);

	const javaResolution = React.useMemo(
		() =>
			resolveServerJavaExecutable({
				provider: settingsForm.provider,
				javaInstallation: settingsForm.java_installation,
				globalDefault: user.java_installation_default,
				runtimes: javaRuntimes,
			}),
		[javaRuntimes, settingsForm.java_installation, settingsForm.provider, user.java_installation_default],
	);
	const effectiveJavaRuntimeLabel = javaResolutionLabel(javaResolution);
	const runCommandPreview = React.useMemo(
		() =>
			buildServerRunCommandPreview({
				ram: settingsForm.ram,
				file: server.file,
				custom_flags: settingsForm.custom_flags,
				java_executable: javaResolution.status === 'resolved' ? javaResolution.executablePath : undefined,
			}),
		[javaResolution, server.file, settingsForm.custom_flags, settingsForm.ram],
	);

	const value: EditServerSettingsContextValue = {
		server,
		javaRuntimes,
		advancedMode: user.advanced_mode,
		globalJavaDefault: user.java_installation_default,
		settingsForm,
		customFlagsDraft,
		setCustomFlagsDraft,
		jdkVersionsDraft,
		setJdkVersionsDraft,
		isJarModalOpen,
		setIsJarModalOpen,
		updateSettingsField,
		updateProvider,
		toggleSettingsBackupMode,
		toggleSupportedTelemetry,
		handleProviderJarDownloaded,
		pickSwapJarFile,
		pickNewDirectory,
		providerCommandSupport,
		runCommandPreview,
		effectiveJavaRuntimeLabel,
		settingsError,
		isFormLocked,
		isSaving,
		isOffline,
		onManualSync,
		handleSaveBackupSettings,
	};

	return <EditServerSettingsContext.Provider value={value}>{children}</EditServerSettingsContext.Provider>;
};

const SectionShell: React.FC<{ children: React.ReactNode; className?: string }> = ({
	children,
	className,
}) => {
	const { isFormLocked } = useEditServerSettings();
	return (
		<div
			aria-disabled={isFormLocked}
			className={clsx('transition-opacity', isFormLocked && 'opacity-50 pointer-events-none', className)}>
			{children}
		</div>
	);
};

const SettingsErrorNote: React.FC = () => {
	const { settingsError } = useEditServerSettings();
	if (!settingsError) return null;
	return <p className='text-sm text-destructive'>{settingsError}</p>;
};

export const GeneralSettingsSection: React.FC = () => {
	const { server, settingsForm, updateSettingsField, onManualSync, isFormLocked, isOffline } =
		useEditServerSettings();
	const { user } = useUser();

	const currentName = getServerNameFromDirectory(settingsForm.new_directory || server.directory);

	const handleNameChange = (newName: string) => {
		const base = server.directory;
		const lastSep = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
		const parent = lastSep >= 0 ? base.slice(0, lastSep + 1) : '';
		updateSettingsField('new_directory', parent + newName);
	};

	return (
		<SectionShell className='space-y-12'>
			<div className='space-y-2 max-w-lg'>
				<Label htmlFor='edit-server-name' className='text-xl'>
					Server Name
				</Label>
				<Input
					id='edit-server-name'
					placeholder='MyServer'
					value={currentName}
					onChange={(event) => handleNameChange(event.target.value)}
				/>
				{user.advanced_mode && (
					<p className='text-sm text-muted-foreground'>
						Renaming will also rename the server folder on disk.
					</p>
				)}
				<SettingsErrorNote />
			</div>
			<div className='space-y-2 max-w-lg'>
				<p className='text-xl'>RAM</p>
				<RamSelector
					provider={settingsForm.provider}
					ram={settingsForm.ram}
					updateField={updateSettingsField}
					className='max-w-lg'
				/>
			</div>
			<div className='space-y-2 max-w-lg'>
				<div className='space-y-1'>
					<p className='text-xl'>Sync mserve.json</p>
					<p className='text-sm text-muted-foreground'>
						Refresh the stored configuration and rebuild it if the file is missing.
					</p>
				</div>
				<Button
					variant='secondary'
					className='w-fit'
					onClick={onManualSync}
					disabled={isFormLocked || !isOffline}>
					<RefreshCcw />
					<span>Sync mserve.json</span>
				</Button>
			</div>

			<div className='space-y-2 max-w-lg'>
				<p className='text-xl'>Auto Restart</p>
				<Label className='flex items-center gap-3'>
					<Checkbox
						checked={settingsForm.auto_restart}
						onCheckedChange={(checked) =>
							updateSettingsField('auto_restart', typeof checked === 'boolean' ? checked : false)
						}
					/>
					Auto restart server when it closes
				</Label>
			</div>
		</SectionShell>
	);
};

export const StorageBackupsSettingsSection: React.FC = () => {
	const {
		settingsForm,
		updateSettingsField,
		toggleSettingsBackupMode,
		server,
		isSaving,
		handleSaveBackupSettings,
	} = useEditServerSettings();
	// Proxy servers (e.g. Velocity) have no world data, so backups don't apply.
	const supportsBackups = !isProxyProvider(settingsForm.provider);
	const isOnline = server.status !== 'offline';
	return (
		<div className='space-y-12'>
			{supportsBackups && (
				<div className='space-y-2 max-w-lg'>
					<Label htmlFor='edit-storage-limit' className='text-xl'>
						Backup storage limit
					</Label>
					<InputGroup>
						<InputGroupInput
							id='edit-storage-limit'
							type='number'
							min={1}
							value={settingsForm.storage_limit}
							onChange={(event) => updateSettingsField('storage_limit', Number(event.target.value))}
						/>
						<InputGroupAddon className='font-mono font-bold uppercase text-xs' align='inline-end'>
							Gigabytes
						</InputGroupAddon>
					</InputGroup>
				</div>
			)}

			{supportsBackups && (
				<div className='space-y-4 max-w-lg'>
					<div className='space-y-2'>
						<p className='text-xl'>Auto backup modes</p>
						<div className='space-y-2'>
							{backupChoices.map((choice) => (
								<Label key={choice.value} className='flex items-center gap-3'>
									<Checkbox
										checked={settingsForm.auto_backup.includes(choice.value)}
										onCheckedChange={(checked) =>
											toggleSettingsBackupMode(
												choice.value,
												typeof checked === 'boolean' ? checked : false,
											)
										}
									/>
									{choice.label}
								</Label>
							))}
						</div>
					</div>

					{settingsForm.auto_backup.includes('interval') && (
						<div className='space-y-2 max-w-lg'>
							<Label htmlFor='edit-backup-interval'>Backup interval</Label>
							<InputGroup>
								<InputGroupInput
									id='edit-backup-interval'
									type='number'
									min={1}
									value={settingsForm.auto_backup_interval}
									onChange={(event) =>
										updateSettingsField('auto_backup_interval', Number(event.target.value))
									}
								/>
								<InputGroupAddon className='font-mono font-bold uppercase text-xs' align='inline-end'>
									Minutes
								</InputGroupAddon>
							</InputGroup>
						</div>
					)}
				</div>
			)}

			{isOnline && (
				<div className='flex justify-end'>
					<Button type='button' onClick={handleSaveBackupSettings} disabled={isSaving}>
						{isSaving ? <Loader className='animate-spin size-4' /> : <Save className='size-4' />}
						{isSaving ? 'Saving...' : 'Save'}
					</Button>
				</div>
			)}
		</div>
	);
};

export const JavaSettingsSection: React.FC = () => {
	const {
		server,
		globalJavaDefault,
		javaRuntimes,
		effectiveJavaRuntimeLabel,
		customFlagsDraft,
		setCustomFlagsDraft,
		runCommandPreview,
		advancedMode,
		settingsForm,
		updateSettingsField,
		isFormLocked,
		isOffline,
		isJarModalOpen,
		setIsJarModalOpen,
		handleProviderJarDownloaded,
		pickSwapJarFile,
	} = useEditServerSettings();

	return (
		<SectionShell className='space-y-12'>
			<div className='space-y-2 max-w-lg'>
				<div className='flex items-center gap-2 flex-wrap'>
					<Label htmlFor='edit-java-runtime' className='text-xl'>
						Java runtime
					</Label>
					{effectiveJavaRuntimeLabel && (
						<span className='rounded-full bg-accent px-2 py-1 text-xs font-medium text-accent-foreground'>
							{effectiveJavaRuntimeLabel}
						</span>
					)}
				</div>
				<p className='text-sm text-muted-foreground -mt-1 mb-2'>
					Pick which detected JDK runs this server. "Automatic" uses the global default:{' '}
					<span className='font-mono'>{globalJavaDefault}</span>
				</p>
				<JavaRuntimeSelect
					id='edit-java-runtime'
					provider={settingsForm.provider}
					javaRuntimes={javaRuntimes}
					value={settingsForm.java_installation}
					onChange={(next) => updateSettingsField('java_installation', next)}
				/>
			</div>

			<ServerJarUpdateSection server={server} disabled={isFormLocked || !isOffline} />

			<div className='space-y-2 max-w-lg'>
				<Label htmlFor='edit-jar-swap' className='text-xl'>
					Swap Server Jar
				</Label>
				<p className='text-sm text-muted-foreground'>
					Download a newer build straight from the provider, or point to a jar file on disk. The jar is
					swapped in when you save.
				</p>
				<div className='flex gap-2'>
					<Button
						type='button'
						variant='outline'
						onClick={() => setIsJarModalOpen(true)}
						disabled={isFormLocked}>
						<Download /> Download from provider
					</Button>
					{advancedMode && (
						<Button type='button' variant='outline' onClick={pickSwapJarFile} disabled={isFormLocked}>
							<FolderOpen /> Browse files
						</Button>
					)}
				</div>
				{advancedMode && (
					<Input
						id='edit-jar-swap'
						placeholder='C:\path\to\another-server.jar'
						value={settingsForm.jar_swap_path}
						onChange={(event) => updateSettingsField('jar_swap_path', event.target.value)}
					/>
				)}
				{settingsForm.jar_swap_path.trim().length > 0 && (
					<p className='text-sm text-muted-foreground break-all'>
						Pending jar: {settingsForm.jar_swap_path}
					</p>
				)}
			</div>

			<SettingsErrorNote />

			<JarDownloadModal
				open={isJarModalOpen}
				onOpenChange={setIsJarModalOpen}
				onDownloaded={handleProviderJarDownloaded}
			/>

			{advancedMode && (
				<div className='space-y-2 max-w-lg'>
					<Label htmlFor='edit-java-installation' className='text-xl'>
						Java installation override
					</Label>
					<p className='text-sm text-muted-foreground -mt-1 mb-2'>
						Point to a specific <span className='font-mono'>java</span> executable. Leave blank to use
						the dropdown / global default.
					</p>
					<Input
						className='font-mono'
						id='edit-java-installation'
						placeholder='C:\Program Files\Java\jdk-25\bin\java.exe'
						value={settingsForm.java_installation}
						onChange={(event) => updateSettingsField('java_installation', event.target.value)}
					/>
				</div>
			)}

			{advancedMode && (
				<div className='space-y-2 max-w-lg'>
					<Label htmlFor='edit-custom-flags' className='text-xl'>
						Extra Java flags
					</Label>
					<Textarea
						id='edit-custom-flags'
						className='min-h-32 font-mono'
						placeholder='--nogui'
						value={customFlagsDraft}
						onChange={(event) => {
							const nextValue = event.target.value;
							setCustomFlagsDraft(nextValue);
							updateSettingsField('custom_flags', parseCustomFlagsInput(nextValue));
						}}
					/>
					<div className='space-y-2'>
						<Label className='text-xl mt-4'>Resolved start command preview</Label>
						<p className='font-mono text-xs px-3 py-1 border-2 border-border rounded-md'>
							{runCommandPreview}
						</p>
					</div>
				</div>
			)}
		</SectionShell>
	);
};

export const ProviderTelemetrySettingsSection: React.FC = () => {
	const {
		advancedMode,
		server,
		settingsForm,
		updateProvider,
		updateSettingsField,
		toggleSupportedTelemetry,
		providerCommandSupport,
		jdkVersionsDraft,
		setJdkVersionsDraft,
	} = useEditServerSettings();

	return (
		<SectionShell className='space-y-12'>
			{advancedMode && (
				<div className='space-y-4 max-w-2xl'>
					<p className='text-xl flex items-center gap-2'>
						Provider
						<Tooltip>
							<TooltipTrigger>
								<Info className='size-5' />
							</TooltipTrigger>
							<TooltipContent>
								Provider metadata controls telemetry and runtime compatibility hints.
							</TooltipContent>
						</Tooltip>
					</p>
					<div className='grid md:grid-cols-2 gap-4 items-start'>
						<div className='space-y-2'>
							<Label htmlFor='edit-provider'>Provider name</Label>
							<Select
								value={settingsForm.provider.name}
								onValueChange={(value) => {
									if (!isServerProvider(value)) return;
									const base = createProvider(value);
									updateProvider((provider) => ({
										...base,
										file: provider.file || server.file || base.file,
										minecraft_version: provider.minecraft_version || base.minecraft_version,
										provider_version: provider.provider_version || base.provider_version,
										jdk_versions:
											provider.jdk_versions.length > 0 ? provider.jdk_versions : base.jdk_versions,
										supported_telemetry:
											provider.supported_telemetry.length > 0
												? provider.supported_telemetry
												: base.supported_telemetry,
										stable: provider.stable,
										download_url: provider.download_url,
									}));
								}}>
								<SelectTrigger id='edit-provider' className='w-full'>
									<SelectValue placeholder='Select provider' />
								</SelectTrigger>
								<SelectContent>
									{PROVIDER_NAMES.map((option) => (
										<SelectItem key={option} value={option}>
											{getProviderDisplayName(option)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className='space-y-2'>
							<Label htmlFor='edit-provider-stable'>Stable release</Label>
							<Label className='flex items-center gap-3'>
								<Checkbox
									checked={settingsForm.provider.stable}
									onCheckedChange={(checked) =>
										updateProvider((provider) => ({
											...provider,
											stable: typeof checked === 'boolean' ? checked : false,
										}))
									}
								/>
								Stable
							</Label>
						</div>

						<div className='space-y-2'>
							<Label htmlFor='edit-provider-minecraft-version'>Minecraft version</Label>
							<Input
								id='edit-provider-minecraft-version'
								placeholder='1.21.11'
								value={settingsForm.provider.minecraft_version}
								onChange={(event) =>
									updateProvider((provider) => ({
										...provider,
										minecraft_version: event.target.value,
									}))
								}
							/>
						</div>

						<div className='space-y-2'>
							<Label htmlFor='edit-provider-provider-version'>Provider version</Label>
							<Input
								id='edit-provider-provider-version'
								placeholder='130'
								value={settingsForm.provider.provider_version}
								onChange={(event) =>
									updateProvider((provider) => ({
										...provider,
										provider_version: event.target.value,
									}))
								}
							/>
						</div>

						<div className='space-y-2'>
							<Label htmlFor='edit-provider-jdk-versions'>
								Supported JDK versions (comma separated)
							</Label>
							<Input
								id='edit-provider-jdk-versions'
								placeholder='17, 21'
								value={jdkVersionsDraft}
								onChange={(event) => {
									const next = event.target.value;
									setJdkVersionsDraft(next);
									updateProvider((provider) => ({
										...provider,
										jdk_versions: parseJdkVersions(next),
									}));
								}}
							/>
						</div>

						<div className='space-y-2'>
							<Label htmlFor='edit-provider-download-url'>Download URL (optional)</Label>
							<Input
								id='edit-provider-download-url'
								placeholder='https://example.com/server.jar'
								value={settingsForm.provider.download_url ?? ''}
								onChange={(event) =>
									updateProvider((provider) => ({
										...provider,
										download_url: event.target.value.trim() || undefined,
									}))
								}
							/>
						</div>
					</div>
				</div>
			)}

			<div className='space-y-2 max-w-2xl'>
				<Label className='text-xl'>Supported telemetry</Label>
				<p className='text-sm text-muted-foreground -mt-2 mb-4'>
					Toggles control which telemetry checks are allowed for this server provider.
				</p>
				<div className='flex flex-col gap-2'>
					{TELEMETRY_POLLING.map((telemetryKey) => {
						const checked = settingsForm.provider.supported_telemetry.includes(telemetryKey);
						const disabled =
							(telemetryKey === 'tps' && !providerCommandSupport.supportsTpsCommand) ||
							(telemetryKey === 'version' && !providerCommandSupport.supportsVersionCommand);
						return (
							<Label key={telemetryKey} className='flex items-center gap-3'>
								<Checkbox
									checked={checked}
									disabled={disabled}
									onCheckedChange={(value) =>
										toggleSupportedTelemetry(
											telemetryKey,
											typeof value === 'boolean' ? value : false,
										)
									}
								/>
								{TELEMETRY_LABELS[telemetryKey]}
							</Label>
						);
					})}
				</div>
			</div>

			{advancedMode && (
				<div className='space-y-4 max-w-lg'>
					<p className='text-xl'>Telemetry target</p>
					<div className='space-y-2'>
						<Label htmlFor='edit-telemetry-host'>Telemetry host</Label>
						<Input
							id='edit-telemetry-host'
							placeholder='127.0.0.1'
							value={settingsForm.telemetry_host}
							onChange={(event) => updateSettingsField('telemetry_host', event.target.value)}
						/>
					</div>
					<div className='space-y-2'>
						<Label htmlFor='edit-telemetry-port'>Telemetry port</Label>
						<Input
							id='edit-telemetry-port'
							type='number'
							min={1}
							max={65535}
							placeholder='25565'
							value={settingsForm.telemetry_port}
							onChange={(event) => updateSettingsField('telemetry_port', Number(event.target.value))}
						/>
					</div>
				</div>
			)}
		</SectionShell>
	);
};

export const LocationSettingsSection: React.FC = () => {
	const { settingsForm, updateSettingsField, pickNewDirectory } = useEditServerSettings();
	return (
		<SectionShell>
			<div className='space-y-2 max-w-lg'>
				<Label htmlFor='edit-new-location' className='text-xl'>
					Move server location
				</Label>
				<div className='flex gap-2'>
					<Input
						id='edit-new-location'
						placeholder='C:\servers\MyServer'
						value={settingsForm.new_directory}
						onChange={(event) => updateSettingsField('new_directory', event.target.value)}
					/>
					<Button type='button' variant='outline' onClick={pickNewDirectory}>
						<FolderOpen /> Browse
					</Button>
				</div>
				<SettingsErrorNote />
			</div>
		</SectionShell>
	);
};
