import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useServers } from '@/data/servers';
import { useUser } from '@/data/user';
import { useNetworks } from '@/data/networks';
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
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { ArrowLeft, Globe, Package, Plug } from 'lucide-react';
import ServerItemList from '@/components/server-item-list';
import { useJavaRuntimes } from '@/data/java-runtimes';
import { resolveServerJavaExecutable } from '@/lib/java-resolution';

import ServerTerminalPanel from './server/server-terminal-panel';
import ServerBackupsTab from './server/server-backups-tab';
import ServerSettingsTab from './server/server-settings-tab';
import ServerPageSkeleton from '@/pages/server/server-page-skeleton';
import { useServerUiState } from './server/hooks/use-server-ui-state';
import { useServerTerminal } from './server/hooks/use-server-terminal';
import { useServerBackupActions } from './server/hooks/use-server-backup-actions';
import { useServerRuntime } from './server/hooks/use-server-runtime';
import ServerOverviewPanel from './server/server-overview-panel';
import ServerStatisticsTab from './server/server-statistics-tab';
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';
import type { ServerContentTab } from './server/server-types';
import ServerContentTabs, {
	getAvailableServerContentTabs,
	getServerContentTabUrl,
	isServerContentTab,
} from './server/server-content-tabs';

const Server: React.FC = () => {
	const navigate = useNavigate();
	const { serverId: routeServerId, tab: routeTab } = useParams();
	const resolvedServerId = routeServerId ? decodeURIComponent(routeServerId) : undefined;
	const { user } = useUser();
	const { servers, isReady, setServerStatus, updateServer, updateServerStats } = useServers();
	const { runtimes: javaRuntimes } = useJavaRuntimes();
	const { networks } = useNetworks();
	const { isBusy, setIsBusy, errorMessage, setErrorMessage, terminalInput, setTerminalInput } =
		useServerUiState();

	const server = React.useMemo(
		() => servers.find((item) => item.id === resolvedServerId),
		[servers, resolvedServerId],
	);

	const serverId = server?.id ?? '';

	const providerCapabilities = React.useMemo(
		() => getServerProviderCapabilities(server?.provider),
		[server?.provider],
	);
	const availableTabs = React.useMemo<ServerContentTab[]>(
		() => getAvailableServerContentTabs(providerCapabilities.kind),
		[providerCapabilities.kind],
	);
	const activeTab = React.useMemo<ServerContentTab>(() => {
		if (isServerContentTab(routeTab) && availableTabs.includes(routeTab)) {
			return routeTab;
		}

		if (availableTabs.includes('overview')) {
			return 'overview';
		}

		return availableTabs[0] ?? 'settings';
	}, [availableTabs, routeTab]);

	React.useEffect(() => {
		if (!server || routeTab === activeTab) {
			return;
		}

		navigate(getServerContentTabUrl(server.id, activeTab), { replace: true });
	}, [activeTab, navigate, routeTab, server]);

	const terminalStoreKey = server?.directory ?? '';
	const {
		terminalLines,
		terminalOutputRef,
		clearTerminalSession,
		clearTerminalConsole,
		jumpTerminalToBottom,
		appendTerminalLine,
	} = useServerTerminal(terminalStoreKey);

	const showError = React.useCallback(
		(error: unknown, fallback: string) => {
			const message = error instanceof Error ? error.message : fallback;
			setErrorMessage(message);
			toast.error(message);
			return message;
		},
		[setErrorMessage],
	);

	// Network membership for this server (proxy or member role).
	const serverNetwork = React.useMemo(
		() =>
			networks.find(
				(n) =>
					n.proxyServerId === server?.id ||
					n.members.some((m) => m.serverId === server?.id),
			) ?? null,
		[networks, server?.id],
	);

	const [showNetworkDialog, setShowNetworkDialog] = React.useState(false);

	const {
		syncServerContents,
		handleItemsChanged,
		handleStart,
		handleStop,
		handleRestart,
		handleForceKill,
		handleTerminalCommandSubmit,
	} = useServerRuntime({
		server,
		serverId,
		isBusy,
		setIsBusy,
		terminalInput,
		setTerminalInput,
		setErrorMessage,
		setServerStatus,
		updateServer,
		updateServerStats,
		appendTerminalLine,
	});

	const {
		handleDeleteBackup,
		handleCreateBackup,
		handleSetStorageLimit,
		handleClearAllBackups,
		handleRestoreBackup,
	} = useServerBackupActions({
		server,
		serverId,
		isBusy,
		setIsBusy,
		updateServer,
		syncServerContents,
		showError,
	});

	// If the server is part of a network, prompt whether to start alone or with
	// the rest of the network; otherwise start immediately.
	const handleStartClick = React.useCallback(() => {
		if (serverNetwork) {
			setShowNetworkDialog(true);
		} else {
			void handleStart();
		}
	}, [serverNetwork, handleStart]);

	const handleStartWithNetwork = React.useCallback(async () => {
		if (!server || !serverNetwork) return;

		const isProxy = serverNetwork.proxyServerId === server.id;

		// Determine which other servers to start alongside this one.
		const otherServerIds = isProxy
			? serverNetwork.members.map((m) => m.serverId)
			: serverNetwork.proxyServerId
				? [serverNetwork.proxyServerId]
				: [];

		const otherServers = servers.filter(
			(s) => otherServerIds.includes(s.id) && s.status === 'offline',
		);

		for (const other of otherServers) {
			const resolution = resolveServerJavaExecutable({
				provider: other.provider,
				javaInstallation: other.java_installation,
				globalDefault: user.java_installation_default,
				runtimes: javaRuntimes,
			});
			const javaExecutable = resolution.status === 'resolved' ? resolution.executablePath : null;
			try {
				await invoke('start_server', { directory: other.directory, javaExecutable });
				toast.info(`Starting ${other.name}…`);
			} catch (err) {
				toast.error(
					`${other.name}: ${err instanceof Error ? err.message : 'Failed to start.'}`,
				);
			}
		}

		void handleStart();
	}, [server, serverNetwork, servers, javaRuntimes, user.java_installation_default, handleStart]);

	if (!isReady) {
		return <ServerPageSkeleton />;
	}

	if (!server) {
		return (
			<main className='h-full pt-15 p-12 w-full overflow-y-auto app-scroll-area app-scroll-stable'>
				<div className='text-muted-foreground'>
					Server not found{resolvedServerId ? ` for id "${resolvedServerId}".` : '.'}
				</div>
				<div className='mt-6'>
					<Button asChild variant='outline'>
						<Link to='/servers'>Back to All Servers</Link>
					</Button>
				</div>
			</main>
		);
	}

	return (
		<main className='w-full h-full relative overflow-y-auto app-scroll-area app-scroll-stable'>
			{/* Start alone vs. with network dialog */}
			<AlertDialog open={showNetworkDialog} onOpenChange={setShowNetworkDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>How do you want to start?</AlertDialogTitle>
						<AlertDialogDescription>
							{server?.name} is part of the network{' '}
							<span className='font-semibold'>{serverNetwork?.name}</span>.{' '}
							{serverNetwork?.proxyServerId === server?.id
								? 'Starting with network will also start all offline member servers.'
								: 'Starting with network will also start the proxy server if it is offline.'}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setShowNetworkDialog(false);
								void handleStart();
							}}
							className='bg-secondary text-secondary-foreground hover:bg-secondary/80'
						>
							Start Alone
						</AlertDialogAction>
						<AlertDialogAction
							onClick={() => {
								setShowNetworkDialog(false);
								void handleStartWithNetwork();
							}}
						>
							Start with Network
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<div className='min-h-full flex flex-col p-12 w-full'>
				{errorMessage && (
					<div className='mb-4 rounded-lg border-2 border-destructive/40 bg-destructive/10 p-3'>
						<div className='flex items-center justify-between gap-3'>
							<p className='text-sm text-destructive'>{errorMessage}</p>
							<Button variant='outline' size='sm' onClick={() => setErrorMessage(null)}>
								Dismiss
							</Button>
						</div>
					</div>
				)}
				<div className='space-y-4 mb-6'>
					<div className='flex gap-2 items-center'>
						<Link to='/'>
							<ArrowLeft className='size-8 transition-transform hover:-translate-x-0.5' />
						</Link>

						<h1 className='text-4xl font-bold leading-0'>{server.name}</h1>
					</div>
					<ServerContentTabs activeTab={activeTab} serverId={server.id} availableTabs={availableTabs} />
				</div>

				{activeTab === 'overview' && (
					<div className='flex flex-col flex-1'>
						<ServerOverviewPanel
							server={server}
							javaInstallationDefault={user.java_installation_default}
							javaRuntimes={javaRuntimes}
							isBusy={isBusy}
							onStart={handleStartClick}
							onStop={handleStop}
							onRestart={handleRestart}
							onForceKill={handleForceKill}
						/>
						<ServerTerminalPanel
							isVisible
							isBusy={isBusy}
							status={server.status}
							terminalLines={terminalLines}
							terminalInput={terminalInput}
							onTerminalInputChange={setTerminalInput}
							onSubmit={handleTerminalCommandSubmit}
							onClearConsole={clearTerminalConsole}
							onJumpToBottom={jumpTerminalToBottom}
							terminalOutputRef={terminalOutputRef}
						/>
					</div>
				)}

				{activeTab === 'statistics' && <ServerStatisticsTab server={server} />}

				{activeTab === 'plugins' && providerCapabilities.kind !== 'vanilla' && (
					<ServerItemList
						icon={<Plug />}
						type='plugin'
						serverDirectory={server.directory}
						title='Plugins'
						searchPlaceholder='Search for Plugin...'
						emptyLabel='No Plugins were found.'
						items={server.plugins}
						onChanged={handleItemsChanged}
						disabled={isBusy || server.status === 'online'}
						ctaLabel='Download More'
						ctaUrl='https://modrinth.com/discover/plugins'
					/>
				)}
				{activeTab === 'worlds' && providerCapabilities.kind !== 'proxy' && (
					<ServerItemList
						icon={<Globe />}
						type='world'
						serverDirectory={server.directory}
						title='Worlds'
						searchPlaceholder='Search for World...'
						emptyLabel='No Worlds were found.'
						items={server.worlds}
						onChanged={handleItemsChanged}
						disabled={isBusy || server.status === 'online'}
					/>
				)}
				{activeTab === 'datapacks' && providerCapabilities.kind !== 'proxy' && (
					<ServerItemList
						icon={<Package />}
						type='datapack'
						serverDirectory={server.directory}
						title='Datapacks'
						searchPlaceholder='Search for Datapack...'
						emptyLabel='No Datapacks were found.'
						items={server.datapacks}
						onChanged={handleItemsChanged}
						disabled={isBusy || server.status === 'online'}
						ctaLabel='Add More'
						ctaUrl='https://modrinth.com/discover/datapacks'
					/>
				)}
				{activeTab === 'backups' && providerCapabilities.kind !== 'proxy' && (
					<ServerBackupsTab
						server={server}
						backups={server.backups}
						isBusy={isBusy}
						isOnline={server.status === 'online'}
						onCreateBackup={handleCreateBackup}
						onRestoreBackup={handleRestoreBackup}
						onDeleteBackup={handleDeleteBackup}
						onSetStorageLimit={handleSetStorageLimit}
						onClearAllBackups={handleClearAllBackups}
					/>
				)}
				{activeTab === 'settings' && (
					<div className='h-[calc(100vh-200px)] flex min-h-0 flex-col'>
						<ServerSettingsTab
							clearTerminalSession={clearTerminalSession}
							server={server}
							javaRuntimes={javaRuntimes}
							isBusy={isBusy}
							setIsBusy={setIsBusy}
							syncServerContents={syncServerContents}
						/>
					</div>
				)}
			</div>
		</main>
	);
};

export default Server;
