import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Download, FolderOpen, Loader, RefreshCcw, RotateCcw, Save, Trash } from 'lucide-react';
import { toast } from 'sonner';
import { isStoppedStatus, type Server, useServers } from '@/data/servers';
import { useExperience, useUser } from '@/data/user';
import { useJavaDownload } from '@/data/java-download';
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
	isServerProvider,
	PROVIDER_NAMES,
} from '@/lib/server-provider';
import { isJavaCompatible, parseJdkVersions } from '@/lib/java-compatibility';
import { type JavaRuntimeInfo } from '@/lib/java-runtime-service';
import { type JavaResolution, javaResolutionLabel, resolveServerJavaExecutable } from '@/lib/java-resolution';
import { getEditableLiteralMotdValue, getStoredLiteralMotdValue } from '@/lib/motd-format';
import MotdEditor from '@/components/motd-editor';
import { examplePaths } from '@/lib/platform';
import { getServerNameFromDirectory } from '@/lib/mserve-server-mapper';
import {
	buildServerRunCommandPreview,
	buildSettingsFormFromServer,
	buildUpdateServerSettingsPayload,
	formatCustomFlagsInput,
	parseCustomFlagsInput,
	resolveNewDirectory,
} from '@/pages/server/server-utils';
import type { ServerSettingsForm, UpdateServerSettingsResult } from '@/pages/server/server-types';
import RamSelector from './ram-selector';
import JavaRuntimeSelect from './java-runtime-select';
import JarDownloadModal, {
	type DownloadedJarSelection,
} from '@/components/jar-browser/jar-download-modal';
import ServerJarUpdateSection from '@/components/server-jar-update-section';
import { HelpButton } from './help/help-button';
import { SettingsRow, SettingsRows } from './settings/settings-row';
import { cn, getErrorMessage } from '@/lib/utils';

const TELEMETRY_LABELS: Record<TelemetryKey, string> = {
	list: 'Players list polling',
	tps: 'TPS polling',
	version: 'Version polling',
	online: 'Online status polling',
	ram: 'RAM metrics',
	cpu: 'CPU metrics',
	provider: 'Provider version telemetry',
};

/** What saving `form` would write, so two forms that save the same compare equal. */
const settingsFormKey = (directory: string, form: ServerSettingsForm) => {
	const payload = buildUpdateServerSettingsPayload(directory, form);
	payload.new_directory = resolveNewDirectory(payload, directory);
	return JSON.stringify(payload);
};

type EditServerSettingsContextValue = {
	server: Server;
	javaRuntimes: JavaRuntimeInfo[];
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
	toggleSupportedTelemetry: (key: TelemetryKey, enabled: boolean) => void;
	handleProviderJarDownloaded: (selection: DownloadedJarSelection) => void;
	pickSwapJarFile: () => Promise<void>;
	pickNewDirectory: () => Promise<void>;
	providerCommandSupport: ReturnType<typeof getDefaultProviderCommandSupport>;
	runCommandPreview: string;
	javaResolution: JavaResolution;
	effectiveJavaRuntimeLabel: string | null;
	settingsError: string | null;
	isFormLocked: boolean;
	isSaving: boolean;
	isOffline: boolean;
	onManualSync?: () => void;
};

const EditServerSettingsContext = React.createContext<EditServerSettingsContextValue | null>(null);

const useEditServerSettings =(): EditServerSettingsContextValue => {
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
	// The saved settings. `server` changes on every telemetry sample, so key the
	// reset on what would be saved rather than on object identity.
	const baselineForm = React.useMemo(() => buildSettingsFormFromServer(server), [server]);
	const baselineKey = React.useMemo(
		() => settingsFormKey(server.directory, baselineForm),
		[baselineForm, server.directory],
	);
	const baselineRef = React.useRef(baselineForm);
	baselineRef.current = baselineForm;
	const [settingsForm, setSettingsForm] = React.useState<ServerSettingsForm>(baselineForm);

	const serverId = server.id;
	const unsavedToastId = React.useMemo(() => `server-settings-unsaved-${serverId}`, [serverId]);
	const providerCommandSupport = React.useMemo(
		() => getDefaultProviderCommandSupport(settingsForm.provider.name),
		[settingsForm.provider.name],
	);
	const isStopped = isStoppedStatus(server.status);
	const isFormLocked = Boolean(disabled || isSaving || !isStopped);
	const isOffline = isStopped;

	// When running, backup settings are saved via their own inline button — the
	// global unsaved-changes toast only applies to offline-only settings.
	const hasUnsavedChanges = React.useMemo(
		() => isStopped && settingsFormKey(server.directory, settingsForm) !== baselineKey,
		[baselineKey, isStopped, server.directory, settingsForm],
	);

	const resetToBaseline = React.useCallback(() => {
		const baseline = baselineRef.current;
		setSettingsForm(baseline);
		setCustomFlagsDraft(formatCustomFlagsInput(baseline.custom_flags));
		setJdkVersionsDraft(baseline.provider.jdk_versions.join(', '));
		setSettingsError(null);
	}, []);

	React.useEffect(() => {
		resetToBaseline();
	}, [baselineKey, resetToBaseline]);

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
			const message = getErrorMessage(err, 'Could not open file picker.');
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
			const message = getErrorMessage(err, 'Could not open directory picker.');
			setSettingsError(message);
		}
	}, [updateSettingsField]);

	const handleResetSettingsForm = React.useCallback(() => {
		resetToBaseline();
		toast.dismiss(unsavedToastId);
	}, [resetToBaseline, unsavedToastId]);

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
				error: (err) => getErrorMessage(err, 'Failed to update server settings.'),
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
				sleep_enabled: payload.sleep_enabled,
				sleep_idle_minutes: payload.sleep_idle_minutes,
				sleep_motd: payload.sleep_motd,
				java_installation: payload.java_installation,
				custom_flags: payload.custom_flags,
				provider: createProvider(result.provider, { file: result.file }),
				telemetry_host: result.telemetryHost,
				telemetry_port: result.telemetryPort,
			});

			setSettingsForm((prev) => ({
				...prev,
				jar_swap_path: '',
				new_directory: result.directory,
			}));
			toast.dismiss(unsavedToastId);
			await onSaved?.();
		} catch (err) {
			const message = getErrorMessage(err, 'Failed to update server settings.');
			setSettingsError(message);
		} finally {
			setIsSaving(false);
		}
	}, [isFormLocked, onSaved, server.directory, serverId, settingsForm, unsavedToastId, updateServer]);

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
		toggleSupportedTelemetry,
		handleProviderJarDownloaded,
		pickSwapJarFile,
		pickNewDirectory,
		providerCommandSupport,
		runCommandPreview,
		javaResolution,
		effectiveJavaRuntimeLabel,
		settingsError,
		isFormLocked,
		isSaving,
		isOffline,
		onManualSync,
	};

	return <EditServerSettingsContext.Provider value={value}>{children}</EditServerSettingsContext.Provider>;
};

const SectionShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { isFormLocked } = useEditServerSettings();
	return (
		<SettingsRows
			aria-disabled={isFormLocked}
			className={cn('transition-opacity', isFormLocked && 'pointer-events-none opacity-50')}>
			{children}
		</SettingsRows>
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
	const { isAdvanced } = useExperience();

	const currentName = getServerNameFromDirectory(settingsForm.new_directory || server.directory);

	const handleNameChange = (newName: string) => {
		const base = server.directory;
		const lastSep = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
		const parent = lastSep >= 0 ? base.slice(0, lastSep + 1) : '';
		updateSettingsField('new_directory', parent + newName);
	};

	return (
		<SectionShell>
			<SettingsRow
				title='Server name'
				htmlFor='edit-server-name'
				description={isAdvanced ? 'Renaming also renames the server folder on disk.' : undefined}>
				<div className='space-y-2'>
					<Input
						id='edit-server-name'
						placeholder='MyServer'
						value={currentName}
						onChange={(event) => handleNameChange(event.target.value)}
					/>
					<SettingsErrorNote />
				</div>
			</SettingsRow>

			<SettingsRow
				title='Memory (RAM)'
				titleAddon={<HelpButton topic='ram' />}
				description='How much memory the server is allowed to use.'>
				<RamSelector provider={settingsForm.provider} ram={settingsForm.ram} updateField={updateSettingsField} />
			</SettingsRow>

			<SettingsRow
				title='Auto restart'
				htmlFor='edit-auto-restart'
				description='Restart the server when it crashes or closes unexpectedly. Runs in the background, so it works with this window closed, and pauses after repeated crashes in a short window so a broken server can’t loop forever.'
				control={
					<Checkbox
						id='edit-auto-restart'
						checked={settingsForm.auto_restart}
						onCheckedChange={(checked) =>
							updateSettingsField('auto_restart', typeof checked === 'boolean' ? checked : false)
						}
					/>
				}
			/>

			<SettingsRow
				title='Sync mserve.json'
				description='Refresh the stored configuration and rebuild it if the file is missing.'
				control={
					<Button variant='secondary' onClick={onManualSync} disabled={isFormLocked || !isOffline}>
						<RefreshCcw />
						<span>Sync mserve.json</span>
					</Button>
				}
			/>
		</SectionShell>
	);
};

export const SleepModeSettingsSection: React.FC = () => {
	const { settingsForm, updateSettingsField, isFormLocked } = useEditServerSettings();
	const { isAdvanced } = useExperience();
	const enabled = settingsForm.sleep_enabled;

	return (
		<SectionShell>
			<SettingsRow
				title='Sleep when no one is playing'
				htmlFor='edit-sleep-enabled'
				description='After the server sits empty for a while, mserve stops it to free up memory and holds its port. Players still see it in their server list, and it boots back up the moment someone tries to join. Sleep state is in-memory, so it resets if mserve is closed.'
				control={
					<Checkbox
						id='edit-sleep-enabled'
						checked={enabled}
						onCheckedChange={(checked) =>
							updateSettingsField('sleep_enabled', typeof checked === 'boolean' ? checked : false)
						}
					/>
				}
			/>

			<SettingsRow
				title='Idle minutes before sleeping'
				htmlFor='sleep-idle-minutes'
				description='How long the server stays empty before it goes to sleep.'
				control={
					<Input
						id='sleep-idle-minutes'
						type='number'
						min={1}
						className='w-24'
						value={settingsForm.sleep_idle_minutes}
						disabled={!enabled || isFormLocked}
						onChange={(event) =>
							updateSettingsField(
								'sleep_idle_minutes',
								Math.max(1, Math.round(Number(event.target.value) || 1)),
							)
						}
					/>
				}
			/>

			<MotdEditor
				label='Sleeping server list message (MOTD)'
				description='Shown in the multiplayer list while the server is asleep.'
				value={getEditableLiteralMotdValue(settingsForm.sleep_motd)}
				onChange={(nextValue) =>
					updateSettingsField('sleep_motd', getStoredLiteralMotdValue(nextValue))
				}
				format='legacy'
				advancedMode={isAdvanced}
				disabled={!enabled || isFormLocked}
			/>
		</SectionShell>
	);
};

/**
 * The beginner Java picker: no runtime list, only the automatic choice. Offers a
 * download when no installed runtime fits, and a way back to automatic for a
 * server pinned to a specific runtime at a higher level.
 */
const AutomaticJavaRuntime: React.FC = () => {
	const { javaResolution, settingsForm, updateSettingsField, isFormLocked } = useEditServerSettings();
	const { ensureJava } = useJavaDownload();
	const { requirement } = javaResolution;
	const neededMajor = requirement.recommendedMajor;

	if (settingsForm.java_installation.trim() !== '') {
		return (
			<div className='space-y-3'>
				<p className='text-sm text-muted-foreground'>
					This server is set to a specific Java runtime. Switch to automatic to let mserve pick a
					compatible one.
				</p>
				<Button
					type='button'
					variant='secondary'
					onClick={() => updateSettingsField('java_installation', '')}
					disabled={isFormLocked}>
					<RotateCcw /> Use automatic
				</Button>
			</div>
		);
	}

	// Same rule as the quick-start surfaces: only offer a download when the
	// fallback runtime is known (not guessed) to be too old.
	const fallbackMajor = javaResolution.status === 'resolved' ? javaResolution.majorVersion : null;
	const isKnownIncompatible =
		fallbackMajor !== null &&
		requirement.confidence === 'high' &&
		!isJavaCompatible(fallbackMajor, requirement);

	if (javaResolution.status === 'missing' || isKnownIncompatible) {
		return (
			<div className='space-y-3'>
				<p className='text-sm text-muted-foreground'>
					{isKnownIncompatible
						? `This server needs Java ${neededMajor}. The newest installed version (Java ${fallbackMajor}) is too old.`
						: `This server needs Java ${neededMajor}, which isn't installed yet.`}
				</p>
				<Button type='button' onClick={() => void ensureJava(neededMajor)} disabled={isFormLocked}>
					<Download /> Download Java {neededMajor}
				</Button>
			</div>
		);
	}

	return (
		<p className='text-sm text-muted-foreground'>
			{javaResolution.pinned
				? 'This server uses the default Java runtime chosen in Settings.'
				: 'mserve picks a compatible Java version for this server automatically.'}
		</p>
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
		settingsForm,
		updateSettingsField,
		isFormLocked,
		isOffline,
		isJarModalOpen,
		setIsJarModalOpen,
		handleProviderJarDownloaded,
		pickSwapJarFile,
	} = useEditServerSettings();
	const { isBeginner, isAdvanced } = useExperience();

	return (
		<>
			<SectionShell>
				<SettingsRow
					title='Java runtime'
					htmlFor={isBeginner ? undefined : 'edit-java-runtime'}
					titleAddon={
						<>
							<HelpButton topic='java' />
							{effectiveJavaRuntimeLabel && (
								<span className='rounded-full bg-accent px-2 py-1 text-xs font-medium text-accent-foreground'>
									{effectiveJavaRuntimeLabel}
								</span>
							)}
						</>
					}
					description={
						isBeginner ? undefined : (
							<>
								Pick which detected JDK runs this server. "Automatic" uses the global default:{' '}
								<span className='font-mono'>{globalJavaDefault}</span>
							</>
						)
					}>
					{isBeginner ? (
						<AutomaticJavaRuntime />
					) : (
						<JavaRuntimeSelect
							id='edit-java-runtime'
							provider={settingsForm.provider}
							javaRuntimes={javaRuntimes}
							value={settingsForm.java_installation}
							onChange={(next) => updateSettingsField('java_installation', next)}
						/>
					)}
				</SettingsRow>

				<ServerJarUpdateSection server={server} disabled={isFormLocked || !isOffline} />

				<SettingsRow
					title='Swap server jar'
					htmlFor={isAdvanced ? 'edit-jar-swap' : undefined}
					description='Download a newer build straight from the provider, or point to a jar file on disk. The jar is swapped in when you save.'
					control={
						<>
							<Button
								type='button'
								variant='secondary'
								onClick={() => setIsJarModalOpen(true)}
								disabled={isFormLocked}>
								<Download /> Download
							</Button>
							{isAdvanced && (
								<Button type='button' variant='secondary' onClick={pickSwapJarFile} disabled={isFormLocked}>
									<FolderOpen /> Browse
								</Button>
							)}
						</>
					}>
					{isAdvanced && (
						<Input
							id='edit-jar-swap'
							placeholder={examplePaths.serverJar}
							value={settingsForm.jar_swap_path}
							onChange={(event) => updateSettingsField('jar_swap_path', event.target.value)}
						/>
					)}
					{settingsForm.jar_swap_path.trim().length > 0 && (
						<p className='text-sm text-muted-foreground break-all'>
							Pending jar: {settingsForm.jar_swap_path}
						</p>
					)}
					<SettingsErrorNote />
				</SettingsRow>

				{isAdvanced && (
					<SettingsRow
						title='Java installation override'
						htmlFor='edit-java-installation'
						description={
							<>
								Point to a specific <span className='font-mono'>java</span> executable. Leave blank to
								use the dropdown / global default.
							</>
						}>
						<Input
							className='font-mono'
							id='edit-java-installation'
							placeholder={examplePaths.javaExecutable}
							value={settingsForm.java_installation}
							onChange={(event) => updateSettingsField('java_installation', event.target.value)}
						/>
					</SettingsRow>
				)}

				{isAdvanced && (
					<SettingsRow
						title='Extra Java flags'
						htmlFor='edit-custom-flags'
						description='Added to the start command, one flag per line.'>
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
							<p className='text-sm font-medium'>Resolved start command preview</p>
							<p className='font-mono text-xs px-3 py-1 border-2 border-border rounded-md'>
								{runCommandPreview}
							</p>
						</div>
					</SettingsRow>
				)}
			</SectionShell>

			<JarDownloadModal
				open={isJarModalOpen}
				onOpenChange={setIsJarModalOpen}
				onDownloaded={handleProviderJarDownloaded}
			/>
		</>
	);
};

export const ProviderTelemetrySettingsSection: React.FC = () => {
	const {
		server,
		settingsForm,
		updateProvider,
		updateSettingsField,
		toggleSupportedTelemetry,
		providerCommandSupport,
		jdkVersionsDraft,
		setJdkVersionsDraft,
	} = useEditServerSettings();
	const { isAdvanced } = useExperience();

	return (
		<SectionShell>
			{isAdvanced && (
				<SettingsRow
					title='Provider'
					description='Provider metadata controls telemetry and runtime compatibility hints.'>
					<div className='grid @md:grid-cols-2 gap-4 items-start'>
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
				</SettingsRow>
			)}

			<SettingsRow
				title='Supported telemetry'
				description='Which telemetry checks mserve is allowed to run for this server provider.'>
				<div className='flex flex-col gap-3'>
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
										toggleSupportedTelemetry(telemetryKey, typeof value === 'boolean' ? value : false)
									}
								/>
								{TELEMETRY_LABELS[telemetryKey]}
							</Label>
						);
					})}
				</div>
			</SettingsRow>

			{isAdvanced && (
				<SettingsRow title='Telemetry target' description='The address mserve polls for telemetry.'>
					<div className='grid gap-4 @md:grid-cols-[minmax(0,1fr)_10rem]'>
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
				</SettingsRow>
			)}
		</SectionShell>
	);
};

export const LocationSettingsSection: React.FC = () => {
	const { settingsForm, updateSettingsField, pickNewDirectory } = useEditServerSettings();
	return (
		<SectionShell>
			<SettingsRow
				title='Server folder'
				htmlFor='edit-new-location'
				description='The folder is moved when you save.'>
				<div className='space-y-2'>
					<div className='flex gap-2'>
						<Input
							id='edit-new-location'
							placeholder={examplePaths.serverDirectory}
							value={settingsForm.new_directory}
							onChange={(event) => updateSettingsField('new_directory', event.target.value)}
						/>
						<Button type='button' variant='secondary' onClick={pickNewDirectory}>
							<FolderOpen /> Browse
						</Button>
					</div>
					<SettingsErrorNote />
				</div>
			</SettingsRow>
		</SectionShell>
	);
};
