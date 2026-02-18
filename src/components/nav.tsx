import React, { useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';
import { SidebarTrigger } from './ui/sidebar';

const appWindow = getCurrentWindow();

const Nav: React.FC = () => {
	const [isMaximized, setIsMaximized] = useState(false);

	const toggleFullscreen = async () => {
		setIsMaximized((prev) => !prev);

		await appWindow.toggleMaximize();
	};

	const minimize = async () => {
		await appWindow.minimize();
	};

	const close = async () => {
		await appWindow.close();
	};

	return (
		<div className='h-10 bg-sidebar border-b-sidebar-border border-b w-full flex fixed top-0 z-50'>
			<div className='h-full flex gap-2 items-center pl-2'>
				<SidebarTrigger />
				<p className='font-bold select-none text-mserve-accent'>MSERVE</p>
				{/* <img src='/MSERVE.png' width={24} height={24} alt='MSERVE' /> */}
			</div>
			<div className='size-full z-10' data-tauri-drag-region />
			<button className='cursor-pointer h-full w-8 center focusable rounded-xl' onClick={minimize}>
				<Minus className='size-6 p-1 hover:bg-sidebar-foreground/30 rounded-sm' />
			</button>
			<button className='cursor-pointer h-full w-8 center focusable rounded-xl' onClick={toggleFullscreen}>
				{isMaximized ? (
					<Copy className='size-6 p-1 hover:bg-sidebar-foreground/30 rounded-sm' />
				) : (
					<Square className='size-6 p-1 hover:bg-sidebar-foreground/30 rounded-sm' />
				)}
			</button>
			<button className='cursor-pointer h-full w-8 center focusable rounded-xl mr-2' onClick={close}>
				<X className='size-6 p-1 hover:bg-red-500/75 rounded-sm' />
			</button>
		</div>
	);
};

export default Nav;
