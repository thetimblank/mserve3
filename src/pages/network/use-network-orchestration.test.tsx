import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { invokeMock, mockInvoke } from '@/test/tauri-mock';
import { createProvider } from '@/lib/server-provider';
import { UserProvider } from '@/data/user';
import { JavaRuntimesProvider, useJavaRuntimes } from '@/data/java-runtimes';
import { ServersProvider, type Server } from '@/data/servers';
import { JavaDownloadProvider } from '@/data/java-download';
import type { ManagedNetwork } from '@/lib/network-schema';
import { useNetworkOrchestration } from './use-network-orchestration';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

const makeServer = (id: string, provider: 'paper' | 'velocity', status: Server['status']): Server =>
	({
		id,
		name: id,
		directory: `C:/servers/${id}`,
		file: 'server.jar',
		status,
		ram: 2,
		java_installation: '',
		custom_flags: [],
		provider: createProvider(provider, { minecraft_version: '1.21', provider_version: '1' }),
		stats: {},
	}) as unknown as Server;

const network = {
	id: 'net',
	name: 'net',
	proxyServerId: 'proxy',
	members: [{ serverId: 'lobby', host: '127.0.0.1', port: 25566, inTry: true, tryIndex: 0 }],
} as unknown as ManagedNetwork;

const wrapper = ({ children }: { children: React.ReactNode }) => (
	<MemoryRouter>
		<UserProvider>
			<JavaRuntimesProvider>
				<ServersProvider>
					<JavaDownloadProvider>{children}</JavaDownloadProvider>
				</ServersProvider>
			</JavaRuntimesProvider>
		</UserProvider>
	</MemoryRouter>
);

afterEach(() => {
	window.localStorage.clear();
});

describe('useNetworkOrchestration', () => {
	it('starts the network around a backend that is already running', async () => {
		mockInvoke('detect_java_runtimes', () => ({
			runtimes: [{ executablePath: 'C:/jdk21/bin/java.exe', majorVersion: 21, version: '21', source: 'path' }],
			errors: [],
			scannedCandidates: 1,
		}));
		let proxyStarted = false;
		mockInvoke('start_server', (args) => {
			if (args?.directory === 'C:/servers/proxy') proxyStarted = true;
		});
		mockInvoke('get_server_runtime', (args) => ({
			state: args?.directory === 'C:/servers/lobby' || proxyStarted ? 'online' : 'offline',
		}));

		const servers = [makeServer('lobby', 'paper', 'online'), makeServer('proxy', 'velocity', 'offline')];
		const { result } = renderHook(
			() => ({ orchestration: useNetworkOrchestration(network, servers), java: useJavaRuntimes() }),
			{ wrapper },
		);
		await waitFor(() => expect(result.current.java.runtimes).toHaveLength(1));

		await act(async () => {
			await result.current.orchestration.startNetwork('sequential');
		});

		const starts = invokeMock.mock.calls.filter(([command]) => command === 'start_server');
		expect(starts).toHaveLength(1);
		expect(starts[0][1]).toMatchObject({ directory: 'C:/servers/proxy' });
	});
});
