import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useServers } from '@/data/servers';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ArrowLeft, Globe, Package, Plug } from 'lucide-react';
import ServerItemList from '@/components/server-item-list';

import ServerTerminalPanel from './server/server-terminal-panel';
import ServerBackupsTab from './server/server-backups-tab';
import ServerSettingsTab from './server/server-settings-tab';
import ServerPageSkeleton from '@/pages/server/server-page-skeleton';
import { useServerUiState } from './server/hooks/use-server-ui-state';
import { useServerTerminal } from './server/hooks/use-server-terminal';
import { useServerBackupActions } from './server/hooks/use-server-backup-actions';
import { useServerRuntime } from './server/hooks/use-server-runtime';
import ServerOverviewPanel from './server/server-overview-panel';

const Server: React.FC = () => {
	const { serverId: routeServerId } = useParams();
	const resolvedServerId = routeServerId ? decodeURIComponent(routeServerId) : undefined;
	const { servers, isReady, setServerStatus, updateServer, updateServerStats } = useServers();
	const {
		isBusy,
		setIsBusy,
		hideBackgroundTelemetry,
		setHideBackgroundTelemetry,
		errorMessage,
		setErrorMessage,
		terminalInput,
		setTerminalInput,
		activeTab,
		setActiveTab,
	} = useServerUiState();

	const server = React.useMemo(
		() => servers.find((item) => item.id === resolvedServerId),
		[servers, resolvedServerId],
	);

	const serverId = server?.id ?? '';
	const terminalStoreKey = server?.directory ?? '';
	const { terminalLines, terminalOutputRef, clearTerminalSession, appendTerminalLine } =
		useServerTerminal(terminalStoreKey);

	const showError = React.useCallback(
		(error: unknown, fallback: string) => {
			const message = error instanceof Error ? error.message : fallback;
			setErrorMessage(message);
			toast.error(message);
			return message;
		},
		[setErrorMessage],
	);

	const {
		syncServerContents,
		handleItemsChanged,
		handleStart,
		handleStop,
		handleRestart,
		handleTerminalCommandSubmit,
	} = useServerRuntime({
		server,
		serverId,
		isBusy,
		setIsBusy,
		hideBackgroundTelemetry,
		terminalInput,
		setTerminalInput,
		setErrorMessage,
		setServerStatus,
		updateServer,
		updateServerStats,
		appendTerminalLine,
		clearTerminalSession,
	});

	const {
		handleDeleteBackup,
		handleCreateBackup,
		handleSetStorageLimit,
		handleSetDeleteInterval,
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
			<div className='min-h-full flex flex-col p-12 pt-20 w-full'>
				{errorMessage && (
					<div className='mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3'>
						<div className='flex items-center justify-between gap-3'>
							<p className='text-sm text-destructive'>{errorMessage}</p>
							<Button variant='outline' size='sm' onClick={() => setErrorMessage(null)}>
								Dismiss
							</Button>
						</div>
					</div>
				)}
				<div className='flex items-center justify-between mb-8'>
					<div>
						<div className='flex gap-2 items-center'>
							<Link to='/'>
								<ArrowLeft className='size-8' />
							</Link>

							<h1 className='text-4xl font-bold'>{server.name}</h1>
						</div>
					</div>
				</div>

				<div>
					<ServerTerminalPanel
						isVisible={server.status !== 'offline'}
						isBusy={isBusy}
						status={server.status}
						terminalLines={terminalLines}
						terminalInput={terminalInput}
						onTerminalInputChange={setTerminalInput}
						onSubmit={handleTerminalCommandSubmit}
						terminalOutputRef={terminalOutputRef}
					/>
				</div>
				<ServerOverviewPanel
					server={server}
					isBusy={isBusy}
					onStart={handleStart}
					onStop={handleStop}
					onRestart={handleRestart}
					activeTab={activeTab}
					onTabChange={setActiveTab}
				/>

				{activeTab === 'plugins' && (
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
				{activeTab === 'worlds' && (
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
				{activeTab === 'datapacks' && (
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
				{activeTab === 'backups' && (
					<ServerBackupsTab
						server={server}
						backups={server.backups}
						isBusy={isBusy}
						isOnline={server.status === 'online'}
						onCreateBackup={handleCreateBackup}
						onRestoreBackup={handleRestoreBackup}
						onDeleteBackup={handleDeleteBackup}
						onSetStorageLimit={handleSetStorageLimit}
						onSetDeleteInterval={handleSetDeleteInterval}
						onClearAllBackups={handleClearAllBackups}
					/>
				)}
				{activeTab === 'settings' && (
					<ServerSettingsTab
						clearTerminalSession={clearTerminalSession}
						server={server}
						isBusy={isBusy}
						setIsBusy={setIsBusy}
						syncServerContents={syncServerContents}
						setHideBackgroundTelemetry={setHideBackgroundTelemetry}
						hideBackgroundTelemetry={hideBackgroundTelemetry}
					/>
				)}
			</div>
		</main>
	);
};

export default Server;
