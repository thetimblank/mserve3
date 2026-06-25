import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Server } from '@/data/servers';
import { invokeMock, emitTauriEvent, mockInvoke } from '@/test/tauri-mock';
import { createProvider } from '@/lib/server-provider';

// The runtime hook leans on three context providers + the toast lib. Mock them
// so the hook can be driven in isolation by emitted backend events.
vi.mock('@/data/user', () => ({ useUser: () => ({ user: { java_installation_default: '' } }) }));
vi.mock('@/data/java-runtimes', () => ({
	useJavaRuntimes: () => ({
		runtimes: [{ executablePath: 'C:/jdk21/bin/java.exe', majorVersion: 21, version: '21.0.1', source: 'path' }],
	}),
}));
vi.mock('@/data/java-download', () => ({ useJavaDownload: () => ({ ensureJava: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import { useServerRuntime } from './use-server-runtime';

const DIR = 'C:/servers/survival';

const makeServer = (over: Partial<Server> = {}): Server =>
	({
		id: 'srv-1',
		name: 'survival',
		directory: DIR,
		file: 'server.jar',
		status: 'offline',
		ram: 4,
		storage_limit: 200,
		auto_backup: [],
		auto_backup_interval: 120,
		auto_restart: false,
		java_installation: '',
		custom_flags: ['--nogui'],
		provider: createProvider('paper', { minecraft_version: '1.21', provider_version: '100' }),
		telemetry_host: '127.0.0.1',
		telemetry_port: 25565,
		created_at: new Date().toISOString(),
		backups: [],
		datapacks: [],
		worlds: [],
		plugins: [],
		stats: {} as Server['stats'],
		...over,
	}) as Server;

const renderRuntime = (server: Server) => {
	const spies = {
		setIsBusy: vi.fn(),
		setTerminalInput: vi.fn(),
		setErrorMessage: vi.fn(),
		setServerStatus: vi.fn(),
		updateServer: vi.fn(),
		updateServerStats: vi.fn(),
		appendTerminalLine: vi.fn(),
	};
	const utils = renderHook(() =>
		useServerRuntime({
			server,
			serverId: server.id,
			isBusy: false,
			terminalInput: '',
			...spies,
		}),
	);
	return { ...utils, spies };
};

afterEach(() => {
	vi.clearAllMocks();
});

describe('useServerRuntime — event-driven lifecycle', () => {
	it('marks the server online on a runtime-state online event', async () => {
		// Let the listen() subscriptions register first.
		mockInvoke('get_server_runtime', () => ({ state: 'offline' }));
		mockInvoke('scan_server_contents', () => ({ plugins: [], worlds: [], datapacks: [], backups: [] }));
		const { spies } = renderRuntime(makeServer());
		await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_server_runtime', expect.anything()));

		await act(async () => {
			emitTauriEvent('server-runtime-state', {
				directory: DIR,
				state: 'online',
				pid: 123,
				startedAt: new Date().toISOString(),
				exitCode: null,
				stderrTail: [],
			});
		});

		expect(spies.setServerStatus).toHaveBeenCalledWith('srv-1', 'online');
		expect(spies.updateServerStats).toHaveBeenCalledWith('srv-1', expect.objectContaining({ online: true }));
	});

	it('maps a telemetry event onto server stats', async () => {
		const { spies } = renderRuntime(makeServer());
		await waitFor(() => expect(invokeMock).toHaveBeenCalled());

		await act(async () => {
			emitTauriEvent('server-telemetry', {
				directory: DIR,
				sample: {
					timestamp: 0,
					online: true,
					playersOnline: 4,
					playersMax: 20,
					serverVersion: '1.21',
					providerVersion: '100',
					tps: 19.8,
					ramUsed: 60,
					cpuUsed: 12,
					uptime: null,
				},
			});
		});

		expect(spies.updateServerStats).toHaveBeenCalledWith(
			'srv-1',
			expect.objectContaining({ players_online: 4, tps: 19.8, ram_used: 60 }),
		);
	});

	it('reports a crash and goes offline when no stop was requested', async () => {
		const { spies } = renderRuntime(makeServer({ auto_restart: false }));
		await waitFor(() => expect(invokeMock).toHaveBeenCalled());

		await act(async () => {
			emitTauriEvent('server-runtime-state', {
				directory: DIR,
				state: 'crashed',
				pid: null,
				startedAt: null,
				exitCode: 1,
				stderrTail: [],
			});
		});

		await waitFor(() =>
			expect(spies.appendTerminalLine).toHaveBeenCalledWith(expect.stringContaining('crashed')),
		);
		expect(spies.setServerStatus).toHaveBeenCalledWith('srv-1', 'offline');
	});

	it('ignores events for a different server directory', async () => {
		const { spies } = renderRuntime(makeServer());
		await waitFor(() => expect(invokeMock).toHaveBeenCalled());
		spies.setServerStatus.mockClear();

		await act(async () => {
			emitTauriEvent('server-runtime-state', {
				directory: 'C:/servers/OTHER',
				state: 'online',
				pid: 1,
				startedAt: null,
				exitCode: null,
				stderrTail: [],
			});
		});

		expect(spies.setServerStatus).not.toHaveBeenCalled();
	});

	it('handleStart resolves Java and invokes start_server', async () => {
		mockInvoke('get_server_start_command', () => 'java -Xmx4G -jar server.jar');
		mockInvoke('start_server', () => undefined);
		mockInvoke('scan_server_contents', () => ({ plugins: [], worlds: [], datapacks: [], backups: [] }));

		const { result, spies } = renderRuntime(makeServer());
		await waitFor(() => expect(invokeMock).toHaveBeenCalled());

		await act(async () => {
			await result.current.handleStart();
		});

		expect(spies.setServerStatus).toHaveBeenCalledWith('srv-1', 'starting');
		expect(invokeMock).toHaveBeenCalledWith(
			'start_server',
			expect.objectContaining({ directory: DIR, javaExecutable: 'C:/jdk21/bin/java.exe' }),
		);
	});
});
