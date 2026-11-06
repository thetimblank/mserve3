import type { ServerContentItem } from '@/data/servers';

export type ServerItemStatusFilter = 'active' | 'inactive';
export type ServerItemSourceFilter = 'modrinth' | 'manual';
export type ServerItemSort = 'name' | 'size' | 'recent';

export type ServerItemQuery = {
	search: string;
	/** `null` = both. */
	status: ServerItemStatusFilter | null;
	/** `null` = both. */
	source: ServerItemSourceFilter | null;
	sort: ServerItemSort;
};

export const DEFAULT_SERVER_ITEM_QUERY: ServerItemQuery = {
	search: '',
	status: null,
	source: null,
	sort: 'name',
};

type FilterableItem = Pick<ServerContentItem, 'name' | 'file' | 'activated' | 'size' | 'source' | 'addedAt'>;

/** Where an item came from: a catalog install (sidecar entry) or by hand. */
export const resolveServerItemSource = (item: FilterableItem): ServerItemSourceFilter =>
	item.source === 'modrinth' ? 'modrinth' : 'manual';

const displayName = (item: FilterableItem) => item.name?.trim() || item.file;

const compareByName = (a: FilterableItem, b: FilterableItem) =>
	displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base', numeric: true });

/**
 * Applies the content tab's search, Status and Source filters, then sorts.
 * Size and "recently added" sort descending; items missing the value go last,
 * and ties fall back to the name so the order is stable.
 */
export const filterServerItems = <T extends FilterableItem>(items: readonly T[], query: ServerItemQuery): T[] => {
	const term = query.search.trim().toLowerCase();

	const filtered = items.filter((item) => {
		if (term) {
			const name = (item.name ?? '').toLowerCase();
			if (!name.includes(term) && !item.file.toLowerCase().includes(term)) return false;
		}
		if (query.status === 'active' && !item.activated) return false;
		if (query.status === 'inactive' && item.activated) return false;
		if (query.source && resolveServerItemSource(item) !== query.source) return false;
		return true;
	});

	// `== null`: the scan sends a missing Rust `Option` as `null`, not `undefined`.
	const descending = (pick: (item: T) => number | null | undefined) => (a: T, b: T) => {
		const left = pick(a);
		const right = pick(b);
		if (left == null && right == null) return compareByName(a, b);
		if (left == null) return 1;
		if (right == null) return -1;
		return right - left || compareByName(a, b);
	};

	const comparator =
		query.sort === 'size'
			? descending((item) => item.size)
			: query.sort === 'recent'
				? descending((item) => item.addedAt)
				: compareByName;

	return [...filtered].sort(comparator);
};

