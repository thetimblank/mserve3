import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetTauriMocks } from './tauri-mock';

// Mock the Tauri IPC + event surface for every test. The factories import the
// shared registry lazily (it is a normal module, evaluated on first use) and
// delegate to the spies defined there.
vi.mock('@tauri-apps/api/core', async () => {
	const { invokeMock } = await import('./tauri-mock');
	return { invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args) };
});

vi.mock('@tauri-apps/api/event', async () => {
	const { listenMock } = await import('./tauri-mock');
	return {
		listen: (event: string, cb: (e: { event: string; payload: unknown; id: number }) => void) =>
			listenMock(event, cb),
	};
});

afterEach(() => {
	cleanup();
	resetTauriMocks();
});
