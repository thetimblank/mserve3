import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { TriangleAlert } from 'lucide-react';
import { useServers } from '@/data/servers';
import { useUser } from '@/data/user';
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

type AppCloseRequestedPayload = {
	runningServerDirectories: string[];
};

export const CloseWarningDialog: React.FC = () => {
	const { servers } = useServers();
	const { user } = useUser();
	const suppressRef = React.useRef(user.suppress_close_warning);
	suppressRef.current = user.suppress_close_warning;

	const [open, setOpen] = React.useState(false);
	const [runningDirectories, setRunningDirectories] = React.useState<string[]>([]);
	const [isStopping, setIsStopping] = React.useState(false);

	React.useEffect(() => {
		let unlisten: (() => void) | undefined;
		listen<AppCloseRequestedPayload>('app-close-requested', (event) => {
			const directories = event.payload.runningServerDirectories;

			if (directories.length === 0) {
				void invoke('confirm_close');
				return;
			}

			if (suppressRef.current) {
				// Kill running servers even when the dialog is suppressed.
				void invoke('force_kill_all_servers')
					.catch(() => {})
					.then(() => new Promise((res) => setTimeout(res, 500)))
					.then(() => invoke('confirm_close'));
				return;
			}

			setRunningDirectories(directories);
			setIsStopping(false);
			setOpen(true);
		})
			.then((fn) => {
				unlisten = fn;
			})
			.catch(() => {});

		return () => {
			unlisten?.();
		};
	}, []);

	const runningServers = React.useMemo(
		() => servers.filter((s) => runningDirectories.includes(s.directory)),
		[servers, runningDirectories],
	);

	const handleStopAllAndShutdown = async () => {
		setIsStopping(true);
		try {
			await invoke('force_kill_all_servers');
			// Give the OS a moment to actually terminate the processes before exit.
			await new Promise((res) => setTimeout(res, 500));
		} catch {
			// Proceed even if kill partially fails
		}
		await invoke('confirm_close');
	};

	const count = runningServers.length || runningDirectories.length;
	const plural = count !== 1;

	return (
		<AlertDialog
			open={open}
			onOpenChange={(isOpen) => {
				if (!isOpen && !isStopping) setOpen(false);
			}}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle className='flex items-center gap-2'>
						<TriangleAlert className='w-5 h-5 text-amber-500 shrink-0' />
						{plural ? 'Servers are' : 'A server is'} still running
					</AlertDialogTitle>
					<AlertDialogDescription>
						Closing MSERVE will force shut down your running server{plural ? 's' : ''} without saving.
						This can cause data loss such as unsaved world data or lost player progress.
					</AlertDialogDescription>
				</AlertDialogHeader>

				{runningServers.length > 0 && (
					<ul className='space-y-1.5 py-1'>
						{runningServers.map((s) => (
							<li key={s.id} className='flex items-center gap-2.5 text-sm'>
								<span className='w-2 h-2 rounded-full bg-green-500 shrink-0' />
								<span className='font-medium'>{s.name}</span>
							</li>
						))}
					</ul>
				)}

				<AlertDialogFooter>
					<Button
						variant='outline'
						onClick={() => setOpen(false)}
						disabled={isStopping}>
						Cancel
					</Button>
					<Button
						variant='destructive'
						onClick={() => void handleStopAllAndShutdown()}
						disabled={isStopping}>
						{isStopping ? 'Shutting down...' : 'Stop All & Shut Down'}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};
