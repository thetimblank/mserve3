import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Check, Eye, EyeOff, FolderOpen, Info, Loader } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { type Server, useServers } from '@/data/servers';
import { useUser } from '@/data/user';
import RamSliderField from '@/components/ram-slider-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { normalizeProviderChecks } from '@/lib/mserve-schema';
import { getDefaultProviderCommandSupport } from '@/lib/server-provider-capabilities';
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
import { useServerUiState } from '@/pages/server/hooks/use-server-ui-state';

type EditServerPropertiesFormProps = {
	server: Server;
	disabled?: boolean;
	onSaved?: () => Promise<void> | void;
	onCancel?: () => void;
	showCancel?: boolean;
	saveLabel?: string;
	className?: string;
};

export const providerOptions = [
	{ value: 'paper', label: 'Paper' },
	{ value: 'folia', label: 'Folia' },
	{ value: 'spigot', label: 'Spigot' },
	{ value: 'purpur', label: 'Purpur' },
	{ value: 'fabric', label: 'Fabric' },
	{ value: 'forge', label: 'Forge / NeoForge' },
	{ value: 'vanilla', label: 'Vanilla' },
	{ value: 'velocity', label: 'Velocity' },
	{ value: 'bungeecord', label: 'BungeeCord' },
	{ value: 'sponge', label: 'Sponge' },
	{ value: 'quilt', label: 'Quilt' },
] as const;

const normalizeProvider = (provider?: string): string => {
	const normalized = provider?.trim().toLowerCase() ?? '';
	if (!normalized) return 'vanilla';

	if (normalized.includes('paper')) return 'paper';
	if (normalized.includes('folia')) return 'folia';
	if (normalized.includes('spigot')) return 'spigot';
	if (normalized.includes('purpur')) return 'purpur';
	if (normalized.includes('fabric')) return 'fabric';
	if (normalized.includes('forge') || normalized.includes('neoforge')) return 'forge';
	if (normalized.includes('velocity')) return 'velocity';
	if (normalized.includes('bungeecord') || normalized.includes('waterfall')) return 'bungeecord';
	if (normalized.includes('sponge')) return 'sponge';
	if (normalized.includes('quilt')) return 'quilt';

	return 'vanilla';
};

const getProviderLabel = (provider: string) =>
	providerOptions.find((option) => option.value === provider)?.label ?? 'Vanilla';

const sameStringList = (left: string[], right: string[]) => {
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
};

const sameProviderChecks = (
	left: ReturnType<typeof normalizeProviderChecks>,
	right: ReturnType<typeof normalizeProviderChecks>,
) =>
	left.list_polling === right.list_polling &&
	left.tps_polling === right.tps_polling &&
	left.version_polling === right.version_polling;

const EditServerPropertiesForm: React.FC<EditServerPropertiesFormProps> = ({
	server,
	disabled,
	onSaved,
	onCancel,
	showCancel,
	saveLabel,
	className,
}) => {
	const { updateServer } = useServers();
	const { user } = useUser();
	const [isSaving, setIsSaving] = React.useState(false);
	const [settingsError, setSettingsError] = React.useState<string | null>(null);
	const [customFlagsDraft, setCustomFlagsDraft] = React.useState('');
	const [settingsForm, setSettingsForm] = React.useState<ServerSettingsForm>({
		ram: 4,
		storage_limit: 200,
		auto_backup: [],
		auto_backup_interval: 120,
		auto_restart: false,
		custom_flags: [],
		java_installation: '',
		provider: 'vanilla',
		version: '',
		provider_checks: normalizeProviderChecks(server.provider_checks),
		jar_swap_path: '',
		new_directory: '',
	});
	const { hideBackgroundTelemetry, setHideBackgroundTelemetry } = useServerUiState();

	const serverId = server.id;
	const unsavedToastId = React.useMemo(() => `server-settings-unsaved-${serverId}`, [serverId]);
	const resolvedProvider = settingsForm.provider;
	const isFormLocked = Boolean(disabled || isSaving || server.status !== 'offline');
	const normalizedServerProvider = React.useMemo(
		() => normalizeProvider(server.provider),
		[server.provider],
	);
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
		if (settingsForm.provider !== normalizedServerProvider) return true;
		if ((settingsForm.version || '').trim() !== (server.version || '').trim()) return true;
		if (
			!sameProviderChecks(settingsForm.provider_checks, normalizeProviderChecks(server.provider_checks))
		) {
			return true;
		}
		if (settingsForm.jar_swap_path.trim().length > 0) return true;
		if (settingsForm.new_directory.trim() !== server.directory.trim()) return true;

		return false;
	}, [
		normalizedServerProvider,
		server.auto_backup,
		server.auto_backup_interval,
		server.auto_restart,
		server.custom_flags,
		server.directory,
		server.java_installation,
		server.ram,
		server.storage_limit,
		server.version,
		server.provider_checks,
		settingsForm,
	]);
	const providerCommandSupport = React.useMemo(
		() => getDefaultProviderCommandSupport(resolvedProvider),
		[resolvedProvider],
	);

	React.useEffect(() => {
		setSettingsForm({
			ram: Math.max(1, server.ram ?? 4),
			storage_limit: Math.max(1, Number(server.storage_limit) || 200),
			auto_backup: server.auto_backup,
			auto_backup_interval: Math.max(1, server.auto_backup_interval),
			auto_restart: server.auto_restart,
			custom_flags: server.custom_flags,
			java_installation: server.java_installation ?? '',
			provider: normalizeProvider(server.provider),
			version: server.version ?? '',
			provider_checks: normalizeProviderChecks(server.provider_checks),
			jar_swap_path: '',
			new_directory: server.directory,
		});
		setCustomFlagsDraft(formatCustomFlagsInput(server.custom_flags));
		setSettingsError(null);
	}, [
		server.auto_backup,
		server.auto_backup_interval,
		server.auto_restart,
		server.custom_flags,
		server.directory,
		server.java_installation,
		server.provider,
		server.provider_checks,
		server.ram,
		server.storage_limit,
		server.version,
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

	const toggleSettingsBackupMode = React.useCallback(
		(mode: (typeof backupChoices)[number]['value'], enabled: boolean) => {
			setSettingsForm((prev) => ({
				...prev,
				auto_backup: toggleBackupMode(prev.auto_backup, mode, enabled),
			}));
		},
		[],
	);

	const toggleProviderCheck = React.useCallback(
		(key: keyof ServerSettingsForm['provider_checks'], enabled: boolean) => {
			setSettingsForm((prev) => ({
				...prev,
				provider_checks: {
					...prev.provider_checks,
					[key]: enabled,
				},
			}));
		},
		[],
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

	const handleSaveSettings = React.useCallback(async () => {
		if (isFormLocked) return;

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
				file: result.file,
				ram: payload.ram,
				storage_limit: payload.storage_limit,
				auto_backup: payload.auto_backup,
				auto_backup_interval: payload.auto_backup_interval,
				auto_restart: payload.auto_restart,
				java_installation: payload.java_installation,
				custom_flags: payload.custom_flags,
				provider: result.provider,
				version: result.version,
				provider_checks: result.provider_checks,
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
	}, [isFormLocked, onSaved, server.directory, serverId, settingsForm, unsavedToastId, updateServer]);

	React.useEffect(() => {
		if (isFormLocked || !hasUnsavedChanges) {
			toast.dismiss(unsavedToastId);
			return;
		}

		toast('You have unsaved changes', {
			id: unsavedToastId,
			duration: Number.POSITIVE_INFINITY,
			action: {
				label: 'Save',
				onClick: () => {
					void handleSaveSettings();
				},
			},
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

	return (
		<div
			aria-disabled={isFormLocked}
			className={clsx(
				'space-y-20 transition-opacity',
				isFormLocked && 'opacity-60 pointer-events-none',
				className,
			)}>
			<RamSliderField
				className='max-w-2xl'
				id='edit-server-ram'
				value={settingsForm.ram}
				onChange={(value) => updateSettingsField('ram', value)}
			/>

			<div className='space-y-2 max-w-md'>
				<Label htmlFor='edit-storage-limit' className='text-xl'>
					Backup storage limit<span className='text-red-500'>*</span>
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

			<div className='space-y-2 max-w-md'>
				<Label htmlFor='edit-java-installation' className='text-xl'>
					Java installation override
				</Label>
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

			<div className='space-y-4 max-w-md'>
				<p className='text-xl flex items-center gap-2'>
					Version and Provider
					<Tooltip>
						<TooltipTrigger>
							<Info className='size-5' />
						</TooltipTrigger>
						<TooltipContent>
							Provider and version are used for provider-specific behavior and telemetry parsing.
						</TooltipContent>
					</Tooltip>
				</p>
				<p className='text-sm text-muted-foreground -mt-4 mb-4'>
					Provider detection: <span className='font-medium'>{getProviderLabel(resolvedProvider)}</span>.
				</p>
				<div className='flex gap-4 items-center w-full'>
					<div className='space-y-2 flex-1'>
						<Label htmlFor='edit-provider'>Server provider</Label>
						<Select
							value={settingsForm.provider}
							onValueChange={(value) => updateSettingsField('provider', value)}>
							<SelectTrigger id='edit-provider' className='w-full'>
								<SelectValue placeholder='Select provider' />
							</SelectTrigger>
							<SelectContent>
								{providerOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				<div className='space-y-2 flex-1'>
					<Label htmlFor='edit-version'>Server version</Label>
					<Input
						id='edit-version'
						placeholder='1.21.5'
						value={settingsForm.version}
						onChange={(event) => updateSettingsField('version', event.target.value)}
					/>
				</div>
			</div>

			<div className='space-y-2 max-w-md'>
				<Label className='text-xl'>Provider telemetry checks</Label>
				<p className='text-sm text-muted-foreground -mt-2 mb-4'>
					Choose what telemetry checks you want. Note, some wont work on certain servers.
				</p>
				<div className='space-y-2'>
					<Label className='flex items-center gap-3'>
						<Checkbox
							checked={
								providerCommandSupport.supportsListCommand &&
								settingsForm.provider_checks.list_polling
							}
							onCheckedChange={(checked) =>
								toggleProviderCheck('list_polling', typeof checked === 'boolean' ? checked : false)
							}
							disabled={!providerCommandSupport.supportsListCommand}
						/>
						List command polling
					</Label>
					<Label className='flex items-center gap-3'>
						<Checkbox
							checked={
								providerCommandSupport.supportsTpsCommand && settingsForm.provider_checks.tps_polling
							}
							onCheckedChange={(checked) =>
								toggleProviderCheck('tps_polling', typeof checked === 'boolean' ? checked : false)
							}
							disabled={!providerCommandSupport.supportsTpsCommand}
						/>
						TPS command polling
					</Label>
					<Label className='flex items-center gap-3'>
						<Checkbox
							checked={
								providerCommandSupport.supportsVersionCommand &&
								settingsForm.provider_checks.version_polling
							}
							onCheckedChange={(checked) =>
								toggleProviderCheck('version_polling', typeof checked === 'boolean' ? checked : false)
							}
							disabled={!providerCommandSupport.supportsVersionCommand}
						/>
						Version command polling
					</Label>
				</div>
				<Button variant='secondary' onClick={() => setHideBackgroundTelemetry((prev) => !prev)}>
					{hideBackgroundTelemetry ? <Eye /> : <EyeOff />}
					{hideBackgroundTelemetry ? 'Show Status Check logs' : 'Hide Status Check logs'}
				</Button>
			</div>

			<div className='space-y-4 max-w-md'>
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
					<div className='space-y-2 max-w-md'>
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

			<div className='space-y-2 max-w-md'>
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

			<div className='space-y-2 max-w-md'>
				<Label htmlFor='edit-custom-flags' className='text-xl'>
					Extra Java flags
				</Label>
				<p className='text-sm text-muted-foreground -mt-2 mb-4'>
					(one per line) These flags are injected after the jar file exactly as configured.
				</p>
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
					<p className='font-mono text-xs px-3 py-1 border border-border rounded-md'>
						{runCommandPreview}
					</p>
				</div>
			</div>

			<div className='space-y-2 max-w-md'>
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

			<div className='space-y-2 mt-6 max-w-md'>
				<Label htmlFor='edit-jar-swap' className='text-xl'>
					Swap server jar with selected jar file
				</Label>
				<p className='text-sm text-muted-foreground -mt-2 mb-4'>
					Selected jar and current server jar will be swapped between their locations.
				</p>
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

			{server.status !== 'offline' && (
				<p className='text-sm text-muted-foreground'>
					Take the server offline before saving these settings.
				</p>
			)}
			{settingsError && <p className='text-sm text-destructive'>{settingsError}</p>}

			{showCancel && (
				<Button variant='outline' type='button' onClick={onCancel}>
					Cancel
				</Button>
			)}
			<Button size='lg' type='button' className='text-md' onClick={handleSaveSettings}>
				{isSaving ? (
					<Loader className='animate-spin size-5' />
				) : (
					(saveLabel ?? <Check className='size-5' />)
				)}
				{isSaving ? 'Saving...' : (saveLabel ?? 'Save properties')}
			</Button>
		</div>
	);
};

export default React.memo(EditServerPropertiesForm);
