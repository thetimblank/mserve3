import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JarVersionRow } from './jar-download-service';
import { createProvider } from './server-provider';

// Mock the IPC-backed jar service so the version-comparison logic in
// checkServerJarUpdate can be exercised without the backend.
vi.mock('./jar-download-service', () => ({
	fetchJarRows: vi.fn(),
	resolveJarRow: vi.fn(),
}));

import { checkServerJarUpdate } from './server-update-service';
import { fetchJarRows, resolveJarRow } from './jar-download-service';

const fetchRowsMock = vi.mocked(fetchJarRows);
const resolveRowMock = vi.mocked(resolveJarRow);

const paperRow = (version: string): JarVersionRow => ({
	id: `paper-${version}`,
	tab: 'plugin',
	providerId: 'paper',
	provider: 'Paper',
	providerDescription: 'Paper',
	version,
	minecraftVersion: version,
	stability: 'stable',
});

const paperProvider = (build: string, mc: string) =>
	createProvider('paper', { provider_version: build, minecraft_version: mc, stable: true });

afterEach(() => {
	vi.clearAllMocks();
});

describe('checkServerJarUpdate (paper)', () => {
	it('flags a newer Minecraft version as an available major update', async () => {
		fetchRowsMock.mockResolvedValue([paperRow('1.21.4'), paperRow('1.20.1')]);
		resolveRowMock.mockResolvedValue({ provider: paperProvider('500', '1.21.4') } as never);

		const result = await checkServerJarUpdate(paperProvider('100', '1.20.1'));
		expect(result.status).toBe('update-available');
		if (result.status === 'update-available') {
			expect(result.isMajorMcChange).toBe(true);
		}
	});

	it('flags a higher build of the same version as a non-major update', async () => {
		fetchRowsMock.mockResolvedValue([paperRow('1.20.1')]);
		resolveRowMock.mockResolvedValue({ provider: paperProvider('200', '1.20.1') } as never);

		const result = await checkServerJarUpdate(paperProvider('100', '1.20.1'));
		expect(result.status).toBe('update-available');
		if (result.status === 'update-available') {
			expect(result.isMajorMcChange).toBe(false);
		}
	});

	it('reports up-to-date when on the latest build of the latest version', async () => {
		fetchRowsMock.mockResolvedValue([paperRow('1.20.1')]);
		resolveRowMock.mockResolvedValue({ provider: paperProvider('100', '1.20.1') } as never);

		const result = await checkServerJarUpdate(paperProvider('100', '1.20.1'));
		expect(result.status).toBe('up-to-date');
	});

	it('reports unsupported when the channel has no rows', async () => {
		fetchRowsMock.mockResolvedValue([]);
		const result = await checkServerJarUpdate(paperProvider('100', '1.20.1'));
		expect(result.status).toBe('unsupported');
	});
});
