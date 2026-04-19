import React from 'react';

const TERMINAL_STORAGE_LINE_LIMIT = 5000;
const TERMINAL_RENDER_LINE_LIMIT = 400;
const TERMINAL_FLUSH_INTERVAL_MS = 120;
const TERMINAL_PERSIST_DEBOUNCE_MS = 1500;
const TERMINAL_STORAGE_PREFIX = 'mserve.terminal.lines.v1:';

const getTerminalStorageKey = (storeKey: string) => `${TERMINAL_STORAGE_PREFIX}${storeKey}`;

const readStoredLines = (storeKey: string): string[] => {
	if (!storeKey || typeof window === 'undefined') {
		return [];
	}

	try {
		const raw = window.localStorage.getItem(getTerminalStorageKey(storeKey));
		if (!raw) {
			return [];
		}

		const parsed = JSON.parse(raw) as string[];
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed
			.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
			.slice(-TERMINAL_STORAGE_LINE_LIMIT);
	} catch {
		return [];
	}
};

const writeStoredLines = (storeKey: string, lines: string[]) => {
	if (!storeKey || typeof window === 'undefined') {
		return;
	}

	try {
		if (lines.length === 0) {
			window.localStorage.removeItem(getTerminalStorageKey(storeKey));
			return;
		}

		window.localStorage.setItem(getTerminalStorageKey(storeKey), JSON.stringify(lines));
	} catch {
		// Ignore local storage failures and continue with in-memory behavior.
	}
};

export const useServerTerminal = (storeKey: string) => {
	const [terminalLines, setTerminalLines] = React.useState<string[]>([]);
	const terminalOutputRef = React.useRef<HTMLDivElement>(null);
	const allLinesRef = React.useRef<string[]>([]);
	const pendingLinesRef = React.useRef<string[]>([]);
	const flushTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const persistTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	const schedulePersist = React.useCallback((key: string) => {
		if (!key) return;
		if (persistTimerRef.current) {
			clearTimeout(persistTimerRef.current);
		}

		persistTimerRef.current = setTimeout(() => {
			persistTimerRef.current = null;
			writeStoredLines(key, allLinesRef.current);
		}, TERMINAL_PERSIST_DEBOUNCE_MS);
	}, []);

	const flushPendingLines = React.useCallback(() => {
		flushTimerRef.current = null;
		if (pendingLinesRef.current.length < 1) return;

		allLinesRef.current = [...allLinesRef.current, ...pendingLinesRef.current].slice(
			-TERMINAL_STORAGE_LINE_LIMIT,
		);
		pendingLinesRef.current = [];
		setTerminalLines(allLinesRef.current.slice(-TERMINAL_RENDER_LINE_LIMIT));
		schedulePersist(storeKey);
	}, [schedulePersist, storeKey]);

	React.useEffect(() => {
		if (flushTimerRef.current) {
			clearTimeout(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		if (persistTimerRef.current) {
			clearTimeout(persistTimerRef.current);
			persistTimerRef.current = null;
		}
		pendingLinesRef.current = [];

		if (!storeKey) {
			allLinesRef.current = [];
			setTerminalLines([]);
			return;
		}

		allLinesRef.current = readStoredLines(storeKey).slice(-TERMINAL_STORAGE_LINE_LIMIT);
		setTerminalLines(allLinesRef.current.slice(-TERMINAL_RENDER_LINE_LIMIT));
	}, [storeKey]);

	React.useEffect(() => {
		return () => {
			if (flushTimerRef.current) {
				clearTimeout(flushTimerRef.current);
				flushTimerRef.current = null;
			}

			if (pendingLinesRef.current.length > 0) {
				allLinesRef.current = [...allLinesRef.current, ...pendingLinesRef.current].slice(
					-TERMINAL_STORAGE_LINE_LIMIT,
				);
				pendingLinesRef.current = [];
			}

			if (persistTimerRef.current) {
				clearTimeout(persistTimerRef.current);
				persistTimerRef.current = null;
			}

			if (storeKey) {
				writeStoredLines(storeKey, allLinesRef.current);
			}
		};
	}, [storeKey]);

	const clearTerminalSession = React.useCallback(() => {
		if (flushTimerRef.current) {
			clearTimeout(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		if (persistTimerRef.current) {
			clearTimeout(persistTimerRef.current);
			persistTimerRef.current = null;
		}
		pendingLinesRef.current = [];
		allLinesRef.current = [];
		setTerminalLines([]);
		writeStoredLines(storeKey, []);
	}, [storeKey]);

	const clearTerminalConsole = clearTerminalSession;

	const jumpTerminalToBottom = React.useCallback(() => {
		const node = terminalOutputRef.current;
		if (!node) return;
		node.scrollTop = node.scrollHeight;
	}, []);

	const appendTerminalLine = React.useCallback(
		(line: string) => {
			if (!storeKey) return;

			const cleaned = line.trim();
			if (!cleaned) {
				return;
			}

			pendingLinesRef.current.push(line);
			if (!flushTimerRef.current) {
				flushTimerRef.current = setTimeout(flushPendingLines, TERMINAL_FLUSH_INTERVAL_MS);
			}
		},
		[flushPendingLines, storeKey],
	);

	React.useEffect(() => {
		const node = terminalOutputRef.current;
		if (!node) return;

		const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
		if (distanceFromBottom > 120) {
			return;
		}

		node.scrollTop = node.scrollHeight;
	}, [terminalLines]);

	return {
		terminalLines,
		terminalOutputRef,
		clearTerminalSession,
		clearTerminalConsole,
		jumpTerminalToBottom,
		appendTerminalLine,
	};
};
