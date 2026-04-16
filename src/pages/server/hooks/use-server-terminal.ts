import React from 'react';

const terminalSessionStore = new Map<string, string[]>();

export const useServerTerminal = (storeKey: string) => {
	const [terminalLines, setTerminalLines] = React.useState<string[]>([]);
	const terminalOutputRef = React.useRef<HTMLDivElement>(null);

	const clearTerminalSession = React.useCallback(() => {
		terminalSessionStore.delete(storeKey);
		setTerminalLines([]);
	}, [storeKey]);

	const appendTerminalLine = React.useCallback(
		(line: string) => {
			setTerminalLines((prev) => {
				const next = [...prev, line].slice(-500);
				terminalSessionStore.set(storeKey, next);
				return next;
			});
		},
		[storeKey],
	);

	React.useEffect(() => {
		setTerminalLines(terminalSessionStore.get(storeKey) ?? []);
	}, [storeKey]);

	React.useEffect(() => {
		const node = terminalOutputRef.current;
		if (!node) return;
		node.scrollTop = node.scrollHeight;
	}, [terminalLines]);

	return {
		terminalLines,
		terminalOutputRef,
		clearTerminalSession,
		appendTerminalLine,
	};
};
