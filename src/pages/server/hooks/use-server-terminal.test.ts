import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useServerTerminal } from './use-server-terminal';

const STORAGE_PREFIX = 'mserve.terminal.lines.v1:';
const FLUSH_MS = 120;
const PERSIST_MS = 1500;

beforeEach(() => {
	vi.useFakeTimers();
	window.localStorage.clear();
});

afterEach(() => {
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
});

describe('useServerTerminal', () => {
	it('buffers appended lines and flushes them on the flush interval', () => {
		const { result } = renderHook(() => useServerTerminal('srv-1'));

		act(() => {
			result.current.appendTerminalLine('hello');
			result.current.appendTerminalLine('world');
		});
		// Not flushed yet.
		expect(result.current.terminalLines).toEqual([]);

		act(() => vi.advanceTimersByTime(FLUSH_MS));
		expect(result.current.terminalLines).toEqual(['hello', 'world']);
	});

	it('ignores empty / whitespace-only lines', () => {
		const { result } = renderHook(() => useServerTerminal('srv-1'));
		act(() => {
			result.current.appendTerminalLine('   ');
			result.current.appendTerminalLine('');
			result.current.appendTerminalLine('real');
			vi.advanceTimersByTime(FLUSH_MS);
		});
		expect(result.current.terminalLines).toEqual(['real']);
	});

	it('persists flushed lines to localStorage after the debounce', () => {
		const { result } = renderHook(() => useServerTerminal('srv-1'));
		act(() => {
			result.current.appendTerminalLine('persist-me');
			vi.advanceTimersByTime(FLUSH_MS);
			vi.advanceTimersByTime(PERSIST_MS);
		});
		const raw = window.localStorage.getItem(`${STORAGE_PREFIX}srv-1`);
		expect(raw).toBeTruthy();
		expect(JSON.parse(raw as string)).toEqual(['persist-me']);
	});

	it('restores stored lines on mount', () => {
		window.localStorage.setItem(`${STORAGE_PREFIX}srv-9`, JSON.stringify(['old-a', 'old-b']));
		const { result } = renderHook(() => useServerTerminal('srv-9'));
		expect(result.current.terminalLines).toEqual(['old-a', 'old-b']);
	});

	it('clearTerminalSession empties the buffer and storage', () => {
		window.localStorage.setItem(`${STORAGE_PREFIX}srv-1`, JSON.stringify(['x']));
		const { result } = renderHook(() => useServerTerminal('srv-1'));

		act(() => result.current.clearTerminalSession());
		expect(result.current.terminalLines).toEqual([]);
		expect(window.localStorage.getItem(`${STORAGE_PREFIX}srv-1`)).toBeNull();
	});

	it('does nothing without a store key', () => {
		const { result } = renderHook(() => useServerTerminal(''));
		act(() => {
			result.current.appendTerminalLine('ignored');
			vi.advanceTimersByTime(FLUSH_MS);
		});
		expect(result.current.terminalLines).toEqual([]);
	});

	it('caps the rendered buffer at 400 lines', () => {
		const { result } = renderHook(() => useServerTerminal('srv-1'));
		act(() => {
			for (let i = 0; i < 450; i += 1) result.current.appendTerminalLine(`line-${i}`);
			vi.advanceTimersByTime(FLUSH_MS);
		});
		const lines = result.current.terminalLines;
		expect(lines).toHaveLength(400);
		// Keeps the most recent lines.
		expect(lines[lines.length - 1]).toBe('line-449');
		expect(lines[0]).toBe('line-50');
	});
});
