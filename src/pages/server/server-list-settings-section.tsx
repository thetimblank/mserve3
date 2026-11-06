import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ImageUp } from 'lucide-react';
import { toast } from 'sonner';

import MotdEditor from '@/components/motd-editor';
import { pickServerIconPath, ServerIconPicker } from '@/components/server-icon-picker';
import { readManagedConfigFile } from '@/components/server-config-file-editor/file-operations';
import { parsePropertiesMap } from '@/components/server-config-file-editor/properties-config';
import { useUnsavedChangesToast } from '@/components/server-config-file-editor/use-unsaved-changes-toast';
import { SettingsRow, SettingsRows } from '@/components/settings/settings-row';
import { Button } from '@/components/ui/button';
import type { Server } from '@/data/servers';
import { useExperience } from '@/data/user';
import { getEditableMotdValue, getStoredMotdValue } from '@/lib/motd-format';
import { loadServerIcon, setServerIconFromPath } from '@/lib/server-icon';
import { type ManagedConfigFileStatus } from '@/lib/server-config-files';
import { isProxyProvider } from '@/lib/server-provider';
import { cn, getErrorMessage } from '@/lib/utils';

type Props = {
	server: Server;
	disabled: boolean;
	/** Called after server.properties was written (it may not have existed before). */
	onPropertiesSaved?: () => Promise<void> | void;
};

/**
 * The MOTD from server.properties, in the editor's format. A server that never
 * started has no server.properties yet, which simply means no MOTD. Any other
 * failure throws, so the editor stays locked instead of saving over a MOTD it
 * could not read.
 */
const readServerMotd = async (directory: string) => {
	const files = await invoke<ManagedConfigFileStatus[]>('scan_managed_server_config_files', { directory });
	if (!files.some((file) => file.fileName === 'server.properties' && file.exists)) {
		return '';
	}
	const { content } = await readManagedConfigFile(directory, 'server.properties');
	return getEditableMotdValue(parsePropertiesMap(content).get('motd') ?? '', 'legacy');
};

const PROXY_MOTD_NOTES: Record<string, string> = {
	velocity: 'Velocity keeps it in velocity.toml, which you can edit under Config files.',
	bungeecord: 'BungeeCord keeps it in config.yml, as the motd of each listener.',
};

/**
 * How the server looks in the multiplayer list: its MOTD and icon. Works before
 * the first start (saving creates server.properties). Proxies only get the icon
 * here, since their MOTD lives in their own config file.
 */
export function ServerListSettingsSection({ server, disabled, onPropertiesSaved }: Props) {
	const { isAdvanced } = useExperience();
	const directory = server.directory;
	const isProxy = isProxyProvider(server.provider);
	const [iconUrl, setIconUrl] = React.useState<string | null>(null);
	const [isIconBusy, setIsIconBusy] = React.useState(false);
	// null while loading, so a save can never write over a MOTD not read yet.
	const [savedMotd, setSavedMotd] = React.useState<string | null>(null);
	const [motd, setMotd] = React.useState('');
	const [motdError, setMotdError] = React.useState<string | null>(null);
	const [isSaving, setIsSaving] = React.useState(false);

	React.useEffect(() => {
		let cancelled = false;
		setSavedMotd(null);
		setMotdError(null);
		loadServerIcon(directory)
			.then((url) => !cancelled && setIconUrl(url))
			.catch(() => !cancelled && setIconUrl(null));
		if (!isProxy) {
			readServerMotd(directory)
				.then((value) => {
					if (cancelled) return;
					setSavedMotd(value);
					setMotd(value);
				})
				.catch((err) => {
					if (cancelled) return;
					setMotdError(
						getErrorMessage(err, 'Could not read server.properties.') +
							' Fix the file, then reopen this page to edit the message.',
					);
				});
		}
		return () => {
			cancelled = true;
		};
	}, [directory, isProxy]);

	const handlePickIcon = React.useCallback(
		async (path: string) => {
			setIsIconBusy(true);
			try {
				await setServerIconFromPath(directory, path);
				setIconUrl(await loadServerIcon(directory));
				toast.success('Server icon saved. Players see it the next time the server starts.');
			} catch (err) {
				toast.error(getErrorMessage(err, 'Could not set the server icon.'));
			} finally {
				setIsIconBusy(false);
			}
		},
		[directory],
	);

	const handleChooseIcon = async () => {
		const path = await pickServerIconPath().catch(() => null);
		if (path) await handlePickIcon(path);
	};

	const toastId = `server-list-motd-${directory}`;
	const isDirty = savedMotd !== null && motd !== savedMotd;

	const resetMotd = React.useCallback(() => setMotd(savedMotd ?? ''), [savedMotd]);

	const saveMotd = React.useCallback(async () => {
		if (disabled || savedMotd === null) return;
		setIsSaving(true);
		try {
			await invoke('apply_server_properties', {
				payload: { directory, updates: [{ key: 'motd', value: getStoredMotdValue(motd, 'legacy') }] },
			});
			setSavedMotd(motd);
			toast.success('Server list message saved.');
			await onPropertiesSaved?.();
		} catch (err) {
			toast.error(getErrorMessage(err, 'Could not save the server list message.'));
		} finally {
			setIsSaving(false);
		}
	}, [directory, disabled, motd, onPropertiesSaved, savedMotd]);

	useUnsavedChangesToast({
		toastId,
		isDirty,
		isLocked: disabled,
		isSaving,
		onReset: resetMotd,
		onSave: saveMotd,
		saveLabel: 'Save message',
	});

	React.useEffect(() => () => void toast.dismiss(toastId), [toastId]);

	const iconPicker = (
		<ServerIconPicker
			iconUrl={iconUrl}
			onPickPath={(path) => void handlePickIcon(path)}
			disabled={disabled}
			busy={isIconBusy}
		/>
	);

	return (
		<SettingsRows
			aria-disabled={disabled}
			className={cn('transition-opacity', disabled && 'pointer-events-none opacity-50')}>
			<SettingsRow
				title='Server icon'
				description='Shown next to your server in the multiplayer list. Any image works: it is cropped to a square and scaled to 64×64.'
				control={
					<Button
						type='button'
						variant='secondary'
						onClick={() => void handleChooseIcon()}
						disabled={disabled || isIconBusy}>
						<ImageUp /> Choose image
					</Button>
				}>
				{isProxy && iconPicker}
			</SettingsRow>

			{isProxy ? (
				<SettingsRow
					title='Message (MOTD)'
					description={
						PROXY_MOTD_NOTES[server.provider.name] ?? 'A proxy keeps its message in its own config file.'
					}
				/>
			) : (
				<div className='space-y-3'>
					<MotdEditor
						label='Message (MOTD)'
						description='The two lines players see under your server in their list. Click the icon to change it, or drop an image on it.'
						title={server.name}
						icon={iconPicker}
						value={motd}
						onChange={setMotd}
						format='legacy'
						advancedMode={isAdvanced}
						disabled={disabled || savedMotd === null}
					/>
					{motdError && <p className='text-sm text-destructive'>{motdError}</p>}
				</div>
			)}
		</SettingsRows>
	);
}
