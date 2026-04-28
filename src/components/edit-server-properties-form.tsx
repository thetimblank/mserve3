import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Check, FolderOpen, Info, Loader, Trash } from 'lucide-react';
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
	isServerProvider,
	PROVIDER_NAMES,
} from '@/lib/server-provider';
import { resolveJavaRequirement } from '@/lib/java-compatibility';
import {
	findJavaRuntimeByExecutablePath,
	getJavaRuntimeBadgeLabel,
	resolveJavaRuntimeForRequirement,
	type JavaRuntimeInfo,
} from '@/lib/java-runtime-service';
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

type EditServerPropertiesFormProps = {
	server: Server;
	javaRuntimes: JavaRuntimeInfo[];
	disabled?: boolean;
	onSaved?: () => Promise<void> | void;
	saveLabel?: string;
	className?: string;
};

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

const EditServerPropertiesForm: React.FC<EditServerPropertiesFormProps> = ({
	server,
	javaRuntimes,
	disabled,
	onSaved,
	className,
}) => {
	const { updateServer } = useServers();
	const { user } = useUser();
	const [isSaving, setIsSaving] = React.useState(false);
	const [settingsError, setSettingsError] = React.useState<string | null>(null);
	const [customFlagsDraft, setCustomFlagsDraft] = React.useState('');
	const [jdkVersionsDraft, setJdkVersionsDraft] = React.useState('21');
	const [settingsForm, setSettingsForm] = React.useState<ServerSettingsForm>({
		ram: 4,
		storage_limit: 200,
		auto_backup: [],
		auto_backup_interval: 120,
		auto_restart: false,
		custom_flags: [],
		java_installation: '',
		provider: createProvider('vanilla'),
		telemetry_host: '127.0.0.1',
		telemetry_port: 25565,
		jar_swap_path: '',
		new_directory: '',
	});

	const serverId = server.id;
	const unsavedToastId = React.useMemo(() => `server-settings-unsaved-${serverId}`, [serverId]);
	const providerCommandSupport = React.useMemo(
		() => getDefaultProviderCommandSupport(settingsForm.provider.name),
		[settingsForm.provider.name],
	);
	const isFormLocked = Boolean(disabled || isSaving || server.status !== 'offline');
	const hasUnsavedChanges = React.useMemo(() => {
		if (settingsForm.ram !== Math.max(1, server.ram ?? 4)) return true;
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
		server.storage_limit,
		server.telemetry_host,
		server.telemetry_port,
		settingsForm,
	]);

	React.useEffect(() => {
		const provider = createProvider(server.provider, { file: server.file });
		setSettingsForm({
			ram: Math.max(1, server.ram ?? 4),
			storage_limit: Math.max(1, Number(server.storage_limit) || 200),
			auto_backup: server.auto_backup,
			auto_backup_interval: Math.max(1, server.auto_backup_interval),
			auto_restart: server.auto_restart,
			custom_flags: server.custom_flags,
			java_installation: server.java_installation ?? '',
			provider,
			telemetry_host: server.telemetry_host ?? '127.0.0.1',
			telemetry_port: Math.max(1, Number(server.telemetry_port) || 25565),
			jar_swap_path: '',
			new_directory: server.directory,
		});
		setCustomFlagsDraft(formatCustomFlagsInput(server.custom_flags));
		setJdkVersionsDraft(provider.jdk_versions.join(', '));
		setSettingsError(null);
	}, [
		server.auto_backup,
		server.auto_backup_interval,
		server.auto_restart,
		server.custom_flags,
		server.directory,
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
		setSettingsForm({
			ram: Math.max(1, server.ram ?? 4),
			storage_limit: Math.max(1, Number(server.storage_limit) || 200),
			auto_backup: server.auto_backup,
			auto_backup_interval: Math.max(1, server.auto_backup_interval),
			auto_restart: server.auto_restart,
			custom_flags: server.custom_flags,
			java_installation: server.java_installation ?? '',
			provider,
			telemetry_host: server.telemetry_host ?? '127.0.0.1',
			telemetry_port: Math.max(1, Number(server.telemetry_port) || 25565),
			jar_swap_path: '',
			new_directory: server.directory,
		});
		setCustomFlagsDraft(formatCustomFlagsInput(server.custom_flags));
		setJdkVersionsDraft(provider.jdk_versions.join(', '));
		setSettingsError(null);
		toast.dismiss(unsavedToastId);
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
		unsavedToastId,
	]);

	const handleSaveSettings = React.useCallback(async () => {
		if (isFormLocked) return;

		const payload = buildUpdateServerSettingsPayload(server.directory, settingsForm);
		if (!payload.java_installation && user.java_installation_default.trim().toLowerCase() === 'java') {
			const requirement = resolveJavaRequirement(
				settingsForm.provider.name,
				settingsForm.provider.minecraft_version,
			);
			const suggestedRuntime = resolveJavaRuntimeForRequirement(javaRuntimes, requirement);
			if (suggestedRuntime) {
				payload.java_installation = suggestedRuntime.executablePath;
			}
		}
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

	React.useEffect(() => {
		if (isFormLocked || !hasUnsavedChanges) {
			toast.dismiss(unsavedToastId);
			return;
		}

		toast('You have unsaved changes', {
			id: unsavedToastId,
			duration: Number.POSITIVE_INFINITY,
			style: {
				'--width': 'min(32rem, calc(100vw - 2rem))',
			} as React.CSSProperties,
			action: (
				<div className='ml-auto flex items-center gap-2'>
					<Button type='button' variant='destructive-secondary' onClick={handleResetSettingsForm}>
						<Trash className='size-4' /> Reset
					</Button>
					<Button type='button' onClick={handleSaveSettings}>
						{isSaving ? <Loader className='animate-spin size-4' /> : <Check className='size-4' />}
						{isSaving ? 'Saving...' : 'Save properties'}
					</Button>
				</div>
			),
		});
	}, [handleSaveSettings, hasUnsavedChanges, isFormLocked, unsavedToastId]);

	const runCommandPreview = React.useMemo(
		() =>
			buildServerRunCommandPreview({
				ram: settingsForm.ram,
				file: server.file,
				custom_flags: settingsForm.custom_flags,
				java_installation: settingsForm.java_installation,
				global_java_installation: user.java_installation_default,
			}),
		[
			server.file,
			settingsForm.custom_flags,
			settingsForm.java_installation,
			settingsForm.ram,
			user.java_installation_default,
		],
	);
	const effectiveJavaInstallation = React.useMemo(
		() => settingsForm.java_installation.trim() || user.java_installation_default.trim(),
		[settingsForm.java_installation, user.java_installation_default],
	);
	const effectiveJavaRuntime = React.useMemo(
		() => findJavaRuntimeByExecutablePath(effectiveJavaInstallation, javaRuntimes),
		[effectiveJavaInstallation, javaRuntimes],
	);
	const effectiveJavaRuntimeLabel = getJavaRuntimeBadgeLabel(effectiveJavaRuntime);

	return (
		<div
			aria-disabled={isFormLocked}
			className={clsx(
				'space-y-20 transition-opacity',
				isFormLocked && 'opacity-50 pointer-events-none',
				className,
			)}>
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

			{user.advanced_mode && (
				<div className='space-y-2 max-w-lg'>
					<div className='flex items-center gap-2 flex-wrap'>
						<Label htmlFor='edit-java-installation' className='text-xl'>
							Java installation override
						</Label>
						{effectiveJavaRuntimeLabel && (
							<span className='rounded-full bg-accent px-2 py-1 text-xs font-medium text-accent-foreground'>
								{effectiveJavaRuntimeLabel}
							</span>
						)}
					</div>
					<p className='text-sm text-muted-foreground -mt-2 mb-4'>
						Leave blank to use global Java default:{' '}
						<span className='font-mono'>{user.java_installation_default}</span>
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

			{user.advanced_mode && (
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
				<div className='grid md:grid-cols-2 gap-2'>
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

			{user.advanced_mode && (
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

			{user.advanced_mode && (
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

			{user.advanced_mode && (
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
				</div>
			)}

			{user.advanced_mode && (
				<div className='space-y-2 mt-6 max-w-lg'>
					<Label htmlFor='edit-jar-swap' className='text-xl'>
						Swap server jar with selected jar file
					</Label>
					<div className='flex gap-2'>
						<Input
							id='edit-jar-swap'
							placeholder='C:\path\to\another-server.jar'
							value={settingsForm.jar_swap_path}
							onChange={(event) => updateSettingsField('jar_swap_path', event.target.value)}
						/>
						<Button type='button' variant='outline' onClick={pickSwapJarFile}>
							<FolderOpen /> Browse
						</Button>
					</div>
				</div>
			)}
			{settingsError && <p className='text-sm text-destructive'>{settingsError}</p>}
		</div>
	);
};

export default React.memo(EditServerPropertiesForm);
