import React from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { ArrowUpRight, CircleCheck, Folder, OctagonX, RefreshCcw, Trash2 } from 'lucide-react';

import type { Server } from '@/data/servers';
import { useServers } from '@/data/servers';
import { useServerJavaResolver } from '@/data/java-download';
import {
	forceKillServer,
	restartServer,
	startServer,
	stopServer,
	type ServerControlContext,
} from '@/lib/server-controls';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '@/components/ui/context-menu';
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

interface ServerNodeMenuProps {
	server: Server;
	role: 'proxy' | 'backend';
	onRemove: () => void;
	children: React.ReactNode;
}

export const ServerNodeMenu: React.FC<ServerNodeMenuProps> = ({ server, role, onRemove, children }) => {
	const navigate = useNavigate();
	const { setServerStatus, updateServerStats } = useServers();
	const resolveServerJava = useServerJavaResolver();
	const [confirmOpen, setConfirmOpen] = React.useState(false);

	const context = (javaExecutable?: string): ServerControlContext => ({
		server,
		javaExecutable,
		setServerStatus,
		updateServerStats,
	});

	// Start/restart resolve a Java runtime first (prompting to download if missing).
	const handleStart = async () => {
		const javaExecutable = await resolveServerJava(server);
		if (javaExecutable) await startServer(context(javaExecutable));
	};

	const handleRestart = async () => {
		const javaExecutable = await resolveServerJava(server);
		if (javaExecutable) await restartServer(context(javaExecutable));
	};

	const status = server.status;
	const canStart = status === 'offline';
	const canStop = status === 'online' || status === 'starting';
	const canRestart = status === 'online' || status === 'starting';
	const canForceKill = status !== 'offline';

	const openFolder = async () => {
		try {
			await invoke('open_server_folder', { directory: server.directory });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to open folder.');
		}
	};

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuLabel className='truncate'>{server.name}</ContextMenuLabel>
					<ContextMenuSeparator />
					<ContextMenuItem onSelect={() => navigate(`/servers/${encodeURIComponent(server.id)}`)}>
						<ArrowUpRight /> Go to server
					</ContextMenuItem>
					{canStart && (
						<ContextMenuItem onSelect={() => void handleStart()}>
							<CircleCheck /> Start
						</ContextMenuItem>
					)}
					{canRestart && (
						<ContextMenuItem onSelect={() => void handleRestart()}>
							<RefreshCcw /> Restart
						</ContextMenuItem>
					)}
					{canStop && (
						<ContextMenuItem onSelect={() => void stopServer(context())}>
							<OctagonX /> Stop
						</ContextMenuItem>
					)}
					{canForceKill && (
						<ContextMenuItem variant='destructive' onSelect={() => void forceKillServer(context())}>
							<OctagonX /> Force kill
						</ContextMenuItem>
					)}
					<ContextMenuSeparator />
					<ContextMenuItem onSelect={() => void openFolder()}>
						<Folder /> Open folder
					</ContextMenuItem>
					<ContextMenuItem
						variant='destructive'
						onSelect={(event) => {
							event.preventDefault();
							// Defer so the closing context menu doesn't fight the dialog for focus.
							setTimeout(() => setConfirmOpen(true), 0);
						}}>
						<Trash2 /> Remove from network
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Remove {server.name} from this network?
						</AlertDialogTitle>
						<AlertDialogDescription>
							{role === 'proxy'
								? 'This detaches the proxy from the network. Its files and the proxy server itself are not deleted.'
								: 'This removes the backend from the network and its auto-assigned port. The server itself is not deleted.'}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							onClick={() => {
								onRemove();
								setConfirmOpen(false);
							}}>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
};
