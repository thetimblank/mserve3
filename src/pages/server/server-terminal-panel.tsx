import React, { useEffect, useState } from 'react';
import { m } from 'motion/react';
import clsx from 'clsx';
import { ChevronsDown, Maximize2, Minimize2, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type ServerTerminalPanelProps = {
	isVisible: boolean;
	isBusy: boolean;
	status: 'online' | 'offline' | 'starting' | 'closing';
	terminalLines: string[];
	terminalInput: string;
	onTerminalInputChange: (value: string) => void;
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
	onClearConsole: () => void;
	onJumpToBottom: () => void;
	terminalOutputRef: React.LegacyRef<HTMLDivElement>;
};

const ServerTerminalPanel: React.FC<ServerTerminalPanelProps> = ({
	isVisible,
	isBusy,
	status,
	terminalLines,
	terminalInput,
	onTerminalInputChange,
	onSubmit,
	onClearConsole,
	onJumpToBottom,
	terminalOutputRef,
}) => {
	const [isFullscreen, setIsFullscreen] = useState(false);
	const terminalText = React.useMemo(() => terminalLines.join('\n'), [terminalLines]);

	useEffect(() => {
		if (!isFullscreen) return;

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setIsFullscreen(false);
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [isFullscreen]);

	if (!isVisible) return null;

	const terminalHeight = isFullscreen ? 'calc(100% - 41px)' : 'auto';

	return (
		<m.div
			initial={{ height: 0, opacity: 0 }}
			animate={{ height: 'auto', opacity: 1 }}
			transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
			className={clsx(
				'bg-black text-white w-full flex font-mono flex-col overflow-hidden',
				isFullscreen ? 'absolute inset-0 z-40 rounded-b-none' : 'rounded-b-xl',
			)}>
			<m.div
				initial={{ height: 0 }}
				animate={{ height: terminalHeight }}
				transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
				ref={terminalOutputRef}
				className='relative min-h-40 overflow-y-auto app-scroll-area px-4 py-2 text-sm gap-0 flex flex-col-reverse'>
				<div className='flex flex-col'>
					<pre className='whitespace-pre-wrap break-all'>{terminalText}</pre>
				</div>
			</m.div>
			<form onSubmit={onSubmit} className='flex border-t-2 border-[#fff5]'>
				<input
					className='text-white w-full outline-none px-4 py-2 h-10'
					placeholder='> '
					value={terminalInput}
					onChange={(event) => onTerminalInputChange(event.target.value)}
					disabled={status === 'offline' || status === 'closing' || isBusy}
				/>
				<div className='flex items-center'>
					<Tooltip>
						<TooltipTrigger asChild>
							<div
								className='text-[#fffa] border-l-2 border-[#fff5] cursor-pointer hover:bg-[#fff2] size-10 flex items-center justify-center'
								onClick={onJumpToBottom}
								aria-label='Jump terminal to latest output'>
								<ChevronsDown className='size-5' />
							</div>
						</TooltipTrigger>
						<TooltipContent side='left'>Jump to bottom</TooltipContent>
					</Tooltip>

					<Tooltip>
						<TooltipTrigger asChild>
							<div
								className='text-[#fffa] border-l-2 border-[#fff5] cursor-pointer hover:bg-[#fff2] size-10 flex items-center justify-center'
								onClick={onClearConsole}
								aria-label='Clear visible console output'>
								<Trash2 className='size-5' />
							</div>
						</TooltipTrigger>
						<TooltipContent side='left'>Clear console</TooltipContent>
					</Tooltip>

					<Tooltip>
						<TooltipTrigger asChild>
							<div
								className='text-[#fffa] border-l-2 border-[#fff5] cursor-pointer hover:bg-[#fff2] size-10 flex items-center justify-center'
								onClick={() => setIsFullscreen((prev) => !prev)}
								aria-label={isFullscreen ? 'Exit terminal fullscreen' : 'Enter terminal fullscreen'}>
								{isFullscreen ? <Minimize2 className='size-5' /> : <Maximize2 className='size-5' />}
							</div>
						</TooltipTrigger>
						<TooltipContent side='left'>
							{isFullscreen ? 'Exit terminal fullscreen (Esc)' : 'Enter terminal fullscreen'}
						</TooltipContent>
					</Tooltip>
				</div>
			</form>
		</m.div>
	);
};

export default React.memo(ServerTerminalPanel);
