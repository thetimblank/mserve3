import { describe, expect, it } from 'vitest';
import { getServerNameFromDirectory, buildCreatedServer, mapSyncedConfigToServer } from './mserve-server-mapper';
import type { SyncedMserveConfig } from './mserve-sync';
import { createDefaultServerSetupForm } from './mserve-sync';
import { createProvider } from './server-provider';

describe('getServerNameFromDirectory', () => {
	it('uses the last path segment (Windows or POSIX separators)', () => {
		expect(getServerNameFromDirectory('C:\\servers\\survival')).toBe('survival');
		expect(getServerNameFromDirectory('/home/me/servers/skyblock')).toBe('skyblock');
	});
	it('ignores trailing separators', () => {
		expect(getServerNameFromDirectory('C:\\servers\\creative\\')).toBe('creative');
	});
	it('falls back to "Server" for empty input', () => {
		expect(getServerNameFromDirectory('')).toBe('Server');
	});
});

describe('buildCreatedServer', () => {
	const result = { id: 'srv-1', file: 'server.jar', directory: 'C:\\servers\\survival' };

	it('derives the shell from the directory and copies init result fields', () => {
		const form = { ...createDefaultServerSetupForm(), provider: createProvider('vanilla')};
		const server = buildCreatedServer(form, result);

		expect(server.id).toBe('srv-1');
		expect(server.file).toBe('server.jar');
		expect(server.name).toBe('survival');
		expect(server.directory).toBe(result.directory);
		expect(server.status).toBe('offline');
		expect(server.telemetry_host).toBe('127.0.0.1');
		expect(server.telemetry_port).toBe(25565);
		// A non-proxy server defaults to the --nogui flag.
		expect(server.custom_flags).toEqual(['--nogui']);
		expect(server.provider.name).toBe('vanilla');
	});

	it('omits --nogui for proxy providers', () => {
		const form = { ...createDefaultServerSetupForm(), provider: createProvider('velocity') };
		const server = buildCreatedServer(form, result);
		expect(server.custom_flags).toEqual([]);
	});

	it('clamps RAM and storage to sane minimums', () => {
		const form = { ...createDefaultServerSetupForm(), provider: createProvider('vanilla'), ram: 0, storage_limit: 0 };
		const server = buildCreatedServer(form, result);
		expect(server.ram).toBeGreaterThanOrEqual(1);
		expect(server.storage_limit).toBeGreaterThanOrEqual(1);
	});
});

describe('ram_mode', () => {
	const result = { id: 'srv-1', file: 'server.jar', directory: 'C:\\servers\\survival' };

	it('new servers default to auto RAM', () => {
		expect(createDefaultServerSetupForm().ram_mode).toBe('auto');
		const form = { ...createDefaultServerSetupForm(), provider: createProvider('paper') };
		expect(buildCreatedServer(form, result).ram_mode).toBe('auto');
	});

	it('a synced config without a known mode reads as manual', () => {
		const config = { file: 'server.jar', ram: 4, provider: createProvider('paper') } as unknown as SyncedMserveConfig;
		expect(mapSyncedConfigToServer(config).ram_mode).toBe('manual');
		expect(mapSyncedConfigToServer({ ...config, ram_mode: 'auto' }).ram_mode).toBe('auto');
	});
});
