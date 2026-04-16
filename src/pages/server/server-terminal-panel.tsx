import React from 'react';
import { m } from 'motion/react';

type ServerTerminalPanelProps = {
	isVisible: boolean;
	isBusy: boolean;
	status: 'online' | 'offline' | 'starting' | 'closing';
	terminalLines: string[];
	terminalInput: string;
	onTerminalInputChange: (value: string) => void;
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
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
	terminalOutputRef,
}) => {
	if (!isVisible) return null;

	return (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			animate={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='bg-black text-white rounded-xl w-full flex font-mono flex-col'>
			<div
				ref={terminalOutputRef}
				className='h-64 overflow-y-auto app-scroll-area px-4 py-2 text-sm space-y-1'>
				{terminalLines.map((line, index) => (
					<p key={`${index}-${line}`}>{line}</p>
				))}
			</div>
			<form onSubmit={onSubmit}>
				<input
					className='text-white w-full outline-none border-t border-muted px-4 py-2'
					placeholder='> '
					value={terminalInput}
					onChange={(event) => onTerminalInputChange(event.target.value)}
					disabled={status !== 'online' || isBusy}
				/>
			</form>
		</m.div>
	);
};

export default React.memo(ServerTerminalPanel);
