import { describe, expect, it } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { emitTauriEvent, mockInvoke } from './tauri-mock';

// Proves the Vitest harness + Tauri mocks are wired correctly. Real tests live
// alongside the code they cover (e.g. src/lib/*.test.ts).
describe('test harness smoke', () => {
	it('runs and has jsdom available', () => {
		expect(typeof document).toBe('object');
		expect(1 + 1).toBe(2);
	});

	it('mocks invoke()', async () => {
		mockInvoke('ping', () => 'pong');
		await expect(invoke('ping')).resolves.toBe('pong');
	});

	it('delivers mocked Tauri events to listeners', async () => {
		const seen: unknown[] = [];
		const unlisten = await listen('demo-event', (e) => seen.push(e.payload));
		emitTauriEvent('demo-event', { value: 42 });
		expect(seen).toEqual([{ value: 42 }]);
		unlisten();
		emitTauriEvent('demo-event', { value: 99 });
		expect(seen).toHaveLength(1);
	});
});
