import { describe, expect, it } from 'vitest';
import { invokeMock, mockInvoke } from '@/test/tauri-mock';
import { createProvider } from '@/lib/server-provider';
import {
	MODRINTH_PAGE_SIZE,
	formatCompactCount,
	formatModrinthCategoryLabel,
	formatModrinthFileSize,
	getModrinthProjectPageUrl,
	installModrinthFile,
	installModrinthModpack,
	resolveModrinthGameVersion,
	resolveModrinthModLoaders,
	resolveModrinthPluginLoaders,
	searchModrinthProjects,
	type ModrinthVersion,
} from './modrinth-service';

const sampleVersion = (): ModrinthVersion => ({
	versionId: 'ver-1',
	projectId: 'proj-1',
	name: 'WorldEdit 7.3',
	versionNumber: '7.3.0',
	gameVersions: ['1.21.1'],
	loaders: ['paper'],
	versionType: 'release',
	datePublished: '2024-06-01T00:00:00Z',
	downloads: 5,
	fileUrl: 'https://cdn.modrinth.com/data/x/versions/y/worldedit.jar',
	fileName: 'worldedit.jar',
	fileSizeBytes: 2048,
	sha512: 'abc123',
});

describe('searchModrinthProjects', () => {
	it('shapes the search payload with defaults', async () => {
		mockInvoke('search_modrinth_projects', () => ({ hits: [], offset: 0, limit: 20, totalHits: 0 }));

		await searchModrinthProjects({ projectType: 'plugin', query: 'world' });

		expect(invokeMock).toHaveBeenCalledWith('search_modrinth_projects', {
			payload: {
				projectType: 'plugin',
				query: 'world',
				loaders: [],
				gameVersions: [],
				categories: [],
				index: 'relevance',
				offset: 0,
				limit: MODRINTH_PAGE_SIZE,
			},
		});
	});
});

describe('installModrinthFile', () => {
	it('maps the version fields into the install payload', async () => {
		mockInvoke('install_modrinth_file', () => ({ file: 'worldedit.jar', sizeBytes: 2048 }));

		await installModrinthFile({
			directory: 'C:/servers/test',
			itemType: 'plugin',
			version: sampleVersion(),
			projectTitle: 'WorldEdit',
			pageUrl: 'https://modrinth.com/plugin/worldedit',
		});

		expect(invokeMock).toHaveBeenCalledWith('install_modrinth_file', {
			payload: {
				directory: 'C:/servers/test',
				itemType: 'plugin',
				url: 'https://cdn.modrinth.com/data/x/versions/y/worldedit.jar',
				fileName: 'worldedit.jar',
				sha512: 'abc123',
				projectId: 'proj-1',
				versionId: 'ver-1',
				name: 'WorldEdit',
				pageUrl: 'https://modrinth.com/plugin/worldedit',
			},
		});
	});
});

describe('installModrinthModpack', () => {
	it('sends the pack url and java executable', async () => {
		mockInvoke('install_modrinth_modpack', () => ({
			directory: 'C:/servers/pack',
			minecraftVersion: '1.21.1',
			providerName: 'neoforge',
			loaderVersion: '21.1.77',
			file: 'server.jar',
			jdkVersions: [21],
			packName: 'Example',
			packVersion: '1.0.0',
		}));

		const result = await installModrinthModpack({
			directory: 'C:/servers/pack',
			version: sampleVersion(),
			javaExecutable: 'C:/java/bin/java.exe',
			installId: 'install-1',
		});

		expect(result.providerName).toBe('neoforge');
		expect(invokeMock).toHaveBeenCalledWith('install_modrinth_modpack', {
			payload: {
				directory: 'C:/servers/pack',
				url: 'https://cdn.modrinth.com/data/x/versions/y/worldedit.jar',
				sha512: 'abc123',
				javaExecutable: 'C:/java/bin/java.exe',
				installId: 'install-1',
			},
		});
	});
});

describe('loader and version pinning', () => {
	it('maps plugin-capable providers to their Modrinth loader facets', () => {
		expect(resolveModrinthPluginLoaders(createProvider('paper'))).toEqual([
			'paper',
			'spigot',
			'bukkit',
		]);
		expect(resolveModrinthPluginLoaders(createProvider('folia'))).toEqual(['folia']);
		expect(resolveModrinthPluginLoaders(createProvider('velocity'))).toEqual(['velocity']);
		expect(resolveModrinthPluginLoaders(createProvider('vanilla'))).toEqual([]);
		expect(resolveModrinthPluginLoaders(null)).toEqual([]);
	});

	it('maps modded providers to their mod loader facet', () => {
		expect(resolveModrinthModLoaders(createProvider('fabric'))).toEqual(['fabric']);
		expect(resolveModrinthModLoaders(createProvider('neoforge'))).toEqual(['neoforge']);
		expect(resolveModrinthModLoaders(createProvider('paper'))).toEqual([]);
	});

	it('pins the game version for game servers but not proxies', () => {
		expect(
			resolveModrinthGameVersion(createProvider('paper', { minecraft_version: '1.21.1' })),
		).toBe('1.21.1');
		expect(
			resolveModrinthGameVersion(createProvider('velocity', { minecraft_version: 'proxy' })),
		).toBeNull();
		expect(resolveModrinthGameVersion(createProvider('paper', { minecraft_version: '' }))).toBeNull();
		expect(resolveModrinthGameVersion(null)).toBeNull();
	});
});

describe('formatting helpers', () => {
	it('builds project page urls', () => {
		expect(getModrinthProjectPageUrl('plugin', 'worldedit')).toBe(
			'https://modrinth.com/plugin/worldedit',
		);
		expect(getModrinthProjectPageUrl('modpack', 'cobblemon')).toBe(
			'https://modrinth.com/modpack/cobblemon',
		);
	});

	it('formats counts, sizes, and category labels', () => {
		expect(formatCompactCount(950)).toBe('950');
		expect(formatCompactCount(1_200_000)).toBe('1.2M');
		expect(formatModrinthFileSize(500)).toBe('500 B');
		expect(formatModrinthFileSize(2048)).toBe('2.0 KB');
		expect(formatModrinthCategoryLabel('game-mechanics')).toBe('Game Mechanics');
	});
});
