import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SERVER_ITEM_QUERY,
	filterServerItems,
	resolveServerItemSource,
	type ServerItemQuery,
} from './server-item-filters';

const items = [
	{ name: 'WorldEdit', file: 'worldedit-7.3.jar', activated: true, size: 3_000, source: 'modrinth', addedAt: 300 },
	{ name: 'Essentials', file: 'EssentialsX.jar', activated: false, size: 9_000, addedAt: 100 },
	{ file: 'anvil-fix.jar', activated: true, size: 500, source: 'modrinth', addedAt: 200 },
	{ name: 'LuckPerms', file: 'LuckPerms.jar', activated: true },
];

const query = (patch: Partial<ServerItemQuery>): ServerItemQuery => ({ ...DEFAULT_SERVER_ITEM_QUERY, ...patch });
const files = (list: { file: string }[]) => list.map((item) => item.file);

describe('filterServerItems', () => {
	it('sorts by display name by default, falling back to the file name', () => {
		expect(files(filterServerItems(items, DEFAULT_SERVER_ITEM_QUERY))).toEqual([
			'anvil-fix.jar',
			'EssentialsX.jar',
			'LuckPerms.jar',
			'worldedit-7.3.jar',
		]);
	});

	it('searches the name and the file name, ignoring case', () => {
		expect(files(filterServerItems(items, query({ search: 'ESSENTIALSX' })))).toEqual(['EssentialsX.jar']);
		expect(files(filterServerItems(items, query({ search: ' worldedit ' })))).toEqual(['worldedit-7.3.jar']);
	});

	it('filters by status', () => {
		expect(files(filterServerItems(items, query({ status: 'inactive' })))).toEqual(['EssentialsX.jar']);
		expect(filterServerItems(items, query({ status: 'active' }))).toHaveLength(3);
	});

	it('filters by source, treating items without a sidecar entry as manual', () => {
		expect(files(filterServerItems(items, query({ source: 'modrinth' })))).toEqual([
			'anvil-fix.jar',
			'worldedit-7.3.jar',
		]);
		expect(files(filterServerItems(items, query({ source: 'manual' })))).toEqual([
			'EssentialsX.jar',
			'LuckPerms.jar',
		]);
	});

	it('combines filters', () => {
		expect(filterServerItems(items, query({ source: 'manual', status: 'inactive', search: 'luck' }))).toEqual([]);
	});

	it('sorts by size and recency descending, with unknown values last', () => {
		expect(files(filterServerItems(items, query({ sort: 'size' })))).toEqual([
			'EssentialsX.jar',
			'worldedit-7.3.jar',
			'anvil-fix.jar',
			'LuckPerms.jar',
		]);
		expect(files(filterServerItems(items, query({ sort: 'recent' })))).toEqual([
			'worldedit-7.3.jar',
			'anvil-fix.jar',
			'EssentialsX.jar',
			'LuckPerms.jar',
		]);
	});

	it('treats null from the scan like a missing value', () => {
		const scanned = [
			{ file: 'b.jar', activated: true, size: null, addedAt: null },
			{ file: 'a.jar', activated: true, size: null, addedAt: null },
			{ file: 'c.jar', activated: true, size: 1, addedAt: 1 },
		] as unknown as typeof items;
		expect(files(filterServerItems(scanned, query({ sort: 'size' })))).toEqual(['c.jar', 'a.jar', 'b.jar']);
		expect(files(filterServerItems(scanned, query({ sort: 'recent' })))).toEqual(['c.jar', 'a.jar', 'b.jar']);
	});

	it('does not mutate the input', () => {
		const copy = [...items];
		filterServerItems(items, query({ sort: 'size' }));
		expect(items).toEqual(copy);
	});
});

describe('resolveServerItemSource', () => {
	it('only counts a Modrinth sidecar entry as Modrinth', () => {
		expect(resolveServerItemSource({ file: 'a.jar', activated: true, source: 'modrinth' })).toBe('modrinth');
		expect(resolveServerItemSource({ file: 'a.jar', activated: true })).toBe('manual');
	});
});
