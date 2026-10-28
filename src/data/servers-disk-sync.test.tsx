import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { mockInvoke } from '@/test/tauri-mock';
import { createProvider } from '@/lib/server-provider';
import { ServersProvider, useServers, type Server } from './servers';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

const STORAGE_KEY = 'mserve.servers.v4';

const storedServer = (id: string, ram: number): Partial<Server> => ({
	id,
	name: id,
	directory: `C:/servers/${id}`,
	file: 'server.jar',
	ram,
	storage_limit: 200,
	auto_backup: [],
	auto_backup_interval: 120,
	auto_restart: false,
	custom_flags: [],
	provider: createProvider('paper', { file: 'server.jar' }),
	telemetry_host: '127.0.0.1',
	telemetry_port: 25565,
	created_at: '2026-01-01T00:00:00.000Z',
});

const diskConfig = (id: string, ram: number) => ({
	...storedServer(id, ram),
	backup_policy: 'smart',
	backup_max_count: 0,
	backup_max_age_days: 0,
	backup_scope: ['worlds'],
	sleep_enabled: false,
	sleep_idle_minutes: 15,
	sleep_motd: '§eSleeping §7— join to wake this server',
	java_installation: null,
});

afterEach(() => {
	window.localStorage.clear();
});

describe('ServersProvider disk sync', () => {
	it('applies mserve.json changes for every server, not just the first one that changed', async () => {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify([storedServer('a', 2), storedServer('b', 2)]));
		// Real IPC resolves on a later task, so React re-renders between servers.
		mockInvoke('sync_server_mserve_json', async (args) => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			const id = String(args?.directory).split('/').pop() ?? '';
			return { status: 'synced', message: '', updated: false, config: diskConfig(id, 8) };
		});

		const wrapper = ({ children }: { children: React.ReactNode }) => <ServersProvider>{children}</ServersProvider>;
		const { result } = renderHook(() => useServers(), { wrapper });

		await waitFor(() => {
			expect(result.current.servers.map((server) => server.ram)).toEqual([8, 8]);
		});
	});
});
