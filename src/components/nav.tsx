import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { Copy, Minus, Moon, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/utils';
import { SidebarTrigger } from './ui/sidebar';

const appWindow = getCurrentWindow();

const Nav: React.FC = () => {
	const [isMaximized, setIsMaximized] = useState(false);

	// The window also maximizes from a drag-region double-click or OS snapping,
	// so follow the real state instead of toggling a local flag.
	useEffect(() => {
		let active = true;
		let unlisten: (() => void) | undefined;
		let pending: ReturnType<typeof setTimeout> | undefined;
		const refresh = () => {
			void appWindow
				.isMaximized()
				.then((maximized) => {
					if (active) setIsMaximized(maximized);
				})
				.catch(() => {});
		};
		// Dragging an edge fires resize events continuously; ask once it settles.
		const refreshSoon = () => {
			clearTimeout(pending);
			pending = setTimeout(refresh, 150);
		};

		refresh();
		appWindow
			.onResized(refreshSoon)
			.then((fn) => {
				if (active) unlisten = fn;
				else fn();
			})
			.catch(() => {});

		return () => {
			active = false;
			clearTimeout(pending);
			unlisten?.();
		};
	}, []);

	const toggleFullscreen = async () => {
		await appWindow.toggleMaximize();
	};

	const minimize = async () => {
		await appWindow.minimize();
	};

	// Tear down the UI (frees the webview's RAM/CPU) while the backend keeps every
	// server running. The window is summoned back from the system tray icon.
	const runInBackground = async () => {
		try {
			await invoke('run_in_background');
		} catch (err) {
			toast.error(getErrorMessage(err, 'Could not move mserve to the background.'));
		}
	};

	const close = async () => {
		await appWindow.close();
	};

	return (
		<div className='h-10 bg-sidebar border-b-sidebar-border border-b-2 w-full flex fixed top-0 z-50'>
			<div className='h-full flex gap-2 items-center pl-2'>
				<SidebarTrigger title='Toggle Sidebar (ctrl + b)' />
				<p className='font-semibold select-none text-mserve-accent'>
					<span className='font-black'>M</span>SERVE
				</p>
			</div>
			<div className='size-full z-10' data-tauri-drag-region />
			<button
				className='cursor-pointer h-full w-8 rounded-xl'
				title='Run in background (keep servers running)'
				onClick={runInBackground}>
				<Moon className='size-6 p-1 hover:bg-sidebar-foreground/30 rounded-sm' />
			</button>
			<button className='cursor-pointer h-full w-8 rounded-xl' onClick={minimize}>
				<Minus className='size-6 p-1 hover:bg-sidebar-foreground/30 rounded-sm' />
			</button>
			<button className='cursor-pointer h-full w-8 rounded-xl' onClick={toggleFullscreen}>
				{isMaximized ? (
					<Copy className='size-6 p-1 hover:bg-sidebar-foreground/30 rounded-sm' />
				) : (
					<Square className='size-6 p-1 hover:bg-sidebar-foreground/30 rounded-sm' />
				)}
			</button>
			<button className='cursor-pointer h-full w-8 rounded-xl mr-2' onClick={close}>
				<X className='size-6 p-1 hover:bg-red-500/75 rounded-sm' />
			</button>
		</div>
	);
};

export default Nav;
