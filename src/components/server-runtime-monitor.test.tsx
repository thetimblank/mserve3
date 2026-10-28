import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { emitTauriEvent, listenMock, mockInvoke } from '@/test/tauri-mock';
import { createProvider } from '@/lib/server-provider';
import { ServersProvider, useServers, type Server } from '@/data/servers';
import { UserProvider } from '@/data/user';
import { JavaRuntimesProvider } from '@/data/java-runtimes';
import { ServerRuntimeMonitor } from './server-runtime-monitor';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

const STORAGE_KEY = 'mserve.servers.v4';

const storedServer = (id: string): Partial<Server> => ({
	id,
	name: id,
	directory: `C:/servers/${id}`,
	file: 'server.jar',
	ram: 2,
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

const wrapper = ({ children }: { children: React.ReactNode }) => (
	<UserProvider>
		<JavaRuntimesProvider>
			<ServersProvider>
				<ServerRuntimeMonitor />
				{children}
			</ServersProvider>
		</JavaRuntimesProvider>
	</UserProvider>
);

afterEach(() => {
	window.localStorage.clear();
});

describe('ServerRuntimeMonitor startup snapshot', () => {
	it('adopts every already-running server, not just the first snapshot to resolve', async () => {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify([storedServer('a'), storedServer('b')]));
		mockInvoke('detect_java_runtimes', () => ({ runtimes: [], errors: [], scannedCandidates: 0 }));
		// Real IPC resolves on a later task, so React re-renders between servers.
		mockInvoke('get_server_runtime', async (args) => {
			const delay = String(args?.directory).endsWith('a') ? 5 : 20;
			await new Promise((resolve) => setTimeout(resolve, delay));
			return {
				state: 'online',
				pid: 1,
				startedAt: null,
				exitCode: null,
				stderrTail: [],
				sample: null,
				serverPort: null,
			};
		});

		const { result } = renderHook(() => useServers(), { wrapper });

		await waitFor(() => {
			expect(result.current.servers.map((server) => server.status)).toEqual(['online', 'online']);
		});
	});

	it('lets a lifecycle event that arrives first win over a slower snapshot', async () => {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify([storedServer('a')]));
		mockInvoke('detect_java_runtimes', () => ({ runtimes: [], errors: [], scannedCandidates: 0 }));
		let resolveSnapshot!: () => void;
		mockInvoke(
			'get_server_runtime',
			() =>
				new Promise((resolve) => {
					resolveSnapshot = () =>
						resolve({
							state: 'offline',
							pid: null,
							startedAt: null,
							exitCode: null,
							stderrTail: [],
							sample: null,
							serverPort: null,
						});
				}),
		);

		const { result } = renderHook(() => useServers(), { wrapper });
		await waitFor(() => expect(resolveSnapshot).toBeTypeOf('function'));
		await waitFor(() => expect(listenMock).toHaveBeenCalledWith('server-runtime-state', expect.any(Function)));

		act(() => {
			emitTauriEvent('server-runtime-state', {
				directory: 'C:/servers/a',
				state: 'starting',
				pid: 1,
				startedAt: null,
				exitCode: null,
				stderrTail: [],
				serverPort: null,
			});
		});
		await act(async () => {
			resolveSnapshot();
		});

		expect(result.current.servers[0].status).toBe('starting');
	});
});
