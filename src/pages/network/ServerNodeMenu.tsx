import React from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { ArrowUpRight, CircleCheck, Folder, Moon, OctagonX, RefreshCcw, Trash2 } from 'lucide-react';

import type { Server } from '@/data/servers';
import {
	canForceKillStatus,
	canRestartStatus,
	canSleepServer,
	canStartStatus,
	canStopStatus,
	forceKillActionLabel,
	startActionLabel,
	stopActionLabel,
} from '@/data/servers';
import { useServerControls } from '@/hooks/use-server-controls';
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
import { getErrorMessage } from '@/lib/utils';

interface ServerNodeMenuProps {
	server: Server;
	role: 'proxy' | 'backend';
	onRemove: () => void;
	children: React.ReactNode;
}

export const ServerNodeMenu: React.FC<ServerNodeMenuProps> = ({ server, role, onRemove, children }) => {
	const navigate = useNavigate();
	const controls = useServerControls(server);
	const [confirmOpen, setConfirmOpen] = React.useState(false);

	const status = server.status;
	const isSleeping = status === 'sleeping';
	// Waking a sleeping server is just a start (the backend tears down its wake
	// listener), so it lives under the same "start" affordance.
	const canStart = canStartStatus(status);
	const canStop = canStopStatus(status);
	const canRestart = canRestartStatus(status);
	const canSleep = canSleepServer(server);
	const canForceKill = canForceKillStatus(status);

	const openFolder = async () => {
		try {
			await invoke('open_server_folder', { directory: server.directory });
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to open folder.'));
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
						<ContextMenuItem onSelect={controls.start}>
							{isSleeping ? <Moon /> : <CircleCheck />} {startActionLabel(status)}
						</ContextMenuItem>
					)}
					{canRestart && (
						<ContextMenuItem onSelect={controls.restart}>
							<RefreshCcw /> Restart
						</ContextMenuItem>
					)}
					{canSleep && (
						<ContextMenuItem onSelect={controls.sleep}>
							<Moon /> Sleep
						</ContextMenuItem>
					)}
					{canStop && (
						<ContextMenuItem onSelect={controls.stop}>
							<OctagonX /> {stopActionLabel(status)}
						</ContextMenuItem>
					)}
					{canForceKill && (
						<ContextMenuItem variant='destructive' onSelect={controls.forceKill}>
							<OctagonX /> {forceKillActionLabel(status)}
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
