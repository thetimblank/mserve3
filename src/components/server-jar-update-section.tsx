import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowUpCircle, CircleCheck, Download, Loader, RefreshCcw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { type Server, useServers } from '@/data/servers';
import { useServerUpdates } from '@/data/server-updates';
import { Button } from '@/components/ui/button';
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { downloadAndResolveJarRow } from '@/lib/jar-download-service';
import { createProvider } from '@/lib/server-provider';
import { getServerNameFromDirectory } from '@/lib/mserve-server-mapper';
import { type ServerUpdateTarget } from '@/lib/server-update-service';
import {
	buildUpdateServerSettingsPayload,
	resolveNewDirectory,
} from '@/pages/server/server-utils';
import type {
	ServerSettingsForm,
	UpdateServerSettingsPayload,
	UpdateServerSettingsResult,
} from '@/pages/server/server-types';

type Props = {
	server: Server;
	/** True while the surrounding settings form is locked (busy or server online). */
	disabled: boolean;
};

const buildUpdatePayload = (
	server: Server,
	target: ServerUpdateTarget,
	downloadedJarPath: string,
): UpdateServerSettingsPayload => {
	// Keep the existing jar filename — only the contents + provider metadata change.
	const provider = createProvider(target.provider, { file: server.file });
	const form: ServerSettingsForm = {
		ram: server.ram,
		storage_limit: server.storage_limit,
		auto_backup: server.auto_backup,
		auto_backup_interval: server.auto_backup_interval,
		auto_restart: server.auto_restart,
		custom_flags: server.custom_flags,
		java_installation: server.java_installation ?? '',
		provider,
		telemetry_host: server.telemetry_host ?? '127.0.0.1',
		telemetry_port: Math.max(1, Number(server.telemetry_port) || 25565),
		jar_swap_path: downloadedJarPath,
		new_directory: server.directory,
	};

	const payload = buildUpdateServerSettingsPayload(server.directory, form);
	payload.new_directory = resolveNewDirectory(payload, server.directory);
	return payload;
};

const ServerJarUpdateSection: React.FC<Props> = ({ server, disabled }) => {
	const { updateServer } = useServers();
	const { getEntry, checkServer } = useServerUpdates();
	const [isUpdating, setIsUpdating] = React.useState(false);
	const [confirmTarget, setConfirmTarget] = React.useState<ServerUpdateTarget | null>(null);

	const entry = getEntry(server.id);
	const isOffline = server.status === 'offline';
	const isChecking = entry.status === 'checking';
	const actionsDisabled = disabled || isUpdating || !isOffline;

	const handleCheck = React.useCallback(() => {
		void checkServer(server);
	}, [checkServer, server]);

	const runUpdate = React.useCallback(
		async (target: ServerUpdateTarget, options: { backup: boolean }) => {
			setConfirmTarget(null);
			setIsUpdating(true);
			try {
				if (options.backup) {
					await toast.promise(
						invoke('create_server_backup', { directory: server.directory }),
						{
							loading: 'Creating backup before updating...',
							success: 'Backup created.',
							error: (err) =>
								err instanceof Error ? err.message : 'Failed to create backup.',
						},
					);
				}

				const updatePromise = (async () => {
					const { result } = await downloadAndResolveJarRow(target.row);
					const payload = buildUpdatePayload(server, target, result.path);
					const settingsResult = await invoke<UpdateServerSettingsResult>(
						'update_server_settings',
						{ payload },
					);
					return settingsResult;
				})();

				toast.promise(updatePromise, {
					loading: 'Downloading and installing the new jar...',
					success: 'Server jar updated.',
					error: (err) => (err instanceof Error ? err.message : 'Failed to update server jar.'),
				});

				const settingsResult = await updatePromise;
				const updatedProvider = createProvider(settingsResult.provider, {
					file: settingsResult.file,
				});

				updateServer(server.id, {
					directory: settingsResult.directory,
					name: getServerNameFromDirectory(settingsResult.directory),
					file: settingsResult.file,
					provider: updatedProvider,
					telemetry_host: settingsResult.telemetry_host,
					telemetry_port: settingsResult.telemetry_port,
				});

				// Re-check against the freshly applied provider so the panel reflects
				// the up-to-date state immediately.
				void checkServer({ ...server, provider: updatedProvider });
			} catch {
				// Errors are surfaced via the toast.promise handlers above.
			} finally {
				setIsUpdating(false);
			}
		},
		[checkServer, server, updateServer],
	);

	const handleUpdateClick = React.useCallback(() => {
		if (entry.status !== 'result' || entry.check.status !== 'update-available') return;
		const { check } = entry;
		if (check.status !== 'update-available') return;

		if (check.isMajorMcChange) {
			setConfirmTarget(check.target);
			return;
		}
		void runUpdate(check.target, { backup: false });
	}, [entry, runUpdate]);

	const { message, hasUpdate, latestLabel, isError } = React.useMemo(() => {
		switch (entry.status) {
			case 'checking':
				return { message: 'Checking for updates...', hasUpdate: false, latestLabel: null, isError: false };
			case 'error':
				return { message: entry.error, hasUpdate: false, latestLabel: null, isError: true };
			case 'result': {
				const { check } = entry;
				if (check.status === 'unsupported') {
					return { message: check.reason, hasUpdate: false, latestLabel: null, isError: false };
				}
				if (check.status === 'up-to-date') {
					return {
						message: `Up to date (${check.currentLabel}).`,
						hasUpdate: false,
						latestLabel: null,
						isError: false,
					};
				}
				return {
					message: `Update available: ${check.currentLabel} → ${check.latestLabel}.${
						check.isMajorMcChange ? ' This crosses a major Minecraft version.' : ''
					}`,
					hasUpdate: true,
					latestLabel: check.latestLabel,
					isError: false,
				};
			}
			default:
				return { message: 'Not checked yet.', hasUpdate: false, latestLabel: null, isError: false };
		}
	}, [entry]);

	const currentLabel =
		entry.status === 'result' && entry.check.status !== 'unsupported'
			? entry.check.currentLabel
			: null;

	return (
		<section className='space-y-3 max-w-lg'>
			<div className='space-y-1'>
				<p className='text-xl flex items-center gap-2'>
					Updates
					{hasUpdate && (
						<span className='rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground'>
							Update available
						</span>
					)}
				</p>
				<p className='text-sm text-muted-foreground'>
					Check the provider for a newer build and install it. The new jar is swapped in over the existing
					one.
				</p>
			</div>

			<div>
				{currentLabel && <p className='font-medium'>Current version: {currentLabel}</p>}
				<p className={`text-sm ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p>
			</div>

			<div className='flex flex-wrap items-center gap-3'>
				<Button variant='secondary' onClick={handleCheck} disabled={isChecking || isUpdating}>
					<RefreshCcw className={isChecking ? 'animate-spin size-4' : 'size-4'} />
					{isChecking ? 'Checking...' : 'Check for updates'}
				</Button>
				<Button onClick={handleUpdateClick} disabled={!hasUpdate || actionsDisabled}>
					{isUpdating ? (
						<Loader className='animate-spin size-4' />
					) : (
						<Download className='size-4' />
					)}
					{isUpdating ? 'Updating...' : latestLabel ? `Update to ${latestLabel}` : 'Update'}
				</Button>
			</div>

			{hasUpdate && !isOffline && (
				<p className='text-sm text-muted-foreground'>
					The server must be offline to install an update.
				</p>
			)}

			<AlertDialog open={confirmTarget !== null} onOpenChange={(open) => !open && setConfirmTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className='flex items-center gap-2'>
							<TriangleAlert className='size-5 text-yellow-600 dark:text-yellow-400' />
							Major Minecraft version change
						</AlertDialogTitle>
						<AlertDialogDescription>
							This update changes the server to a new major Minecraft version
							{entry.status === 'result' && entry.check.status === 'update-available'
								? ` (${entry.check.currentLabel} → ${entry.check.latestLabel})`
								: ''}
							. Major version changes can have unwanted effects, including world data loss or
							corruption and incompatible plugins. We strongly recommend backing up first.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<Button
							variant='secondary'
							onClick={() => confirmTarget && void runUpdate(confirmTarget, { backup: false })}>
							<ArrowUpCircle className='size-4' />
							Proceed
						</Button>
						<Button
							onClick={() => confirmTarget && void runUpdate(confirmTarget, { backup: true })}>
							<CircleCheck className='size-4' />
							Backup &amp; Proceed
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
};

export default ServerJarUpdateSection;
