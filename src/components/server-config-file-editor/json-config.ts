import type { JsonColumn, JsonColumnKind, JsonRecord, JsonRow, PropertyValues } from './types';
import { isRecord, makeRowId, prettifyKey, sameStringRecord, stringifyStructuredValue } from './utils';

const getJsonValueKind = (value: unknown): JsonColumnKind => {
	if (typeof value === 'number') return 'number';
	if (typeof value === 'boolean') return 'boolean';
	if (isRecord(value) || Array.isArray(value)) return 'json';
	return 'string';
};

const inferJsonColumnKind = (records: JsonRecord[], key: string): JsonColumnKind => {
	let resolvedKind: JsonColumnKind | null = null;

	for (const record of records) {
		if (!(key in record)) continue;

		const nextKind = getJsonValueKind(record[key]);
		if (!resolvedKind) {
			resolvedKind = nextKind;
			continue;
		}

		if (resolvedKind !== nextKind) {
			if (resolvedKind === 'json' || nextKind === 'json') return 'json';
			return 'string';
		}
	}

	return resolvedKind ?? 'string';
};

const defaultJsonColumnsForFile = (fileName: string): Array<Pick<JsonColumn, 'key' | 'label' | 'kind'>> => {
	switch (fileName.trim().toLowerCase()) {
		case 'ops.json':
			return [
				{ key: 'uuid', label: 'UUID', kind: 'string' },
				{ key: 'name', label: 'Name', kind: 'string' },
				{ key: 'level', label: 'Level', kind: 'number' },
				{ key: 'bypassesPlayerLimit', label: 'Bypasses player limit', kind: 'boolean' },
			];
		case 'whitelist.json':
			return [
				{ key: 'uuid', label: 'UUID', kind: 'string' },
				{ key: 'name', label: 'Name', kind: 'string' },
			];
		case 'banned-ips.json':
			return [
				{ key: 'ip', label: 'IP address', kind: 'string' },
				{ key: 'created', label: 'Created', kind: 'string' },
				{ key: 'source', label: 'Source', kind: 'string' },
				{ key: 'expires', label: 'Expires', kind: 'string' },
				{ key: 'reason', label: 'Reason', kind: 'string' },
			];
		case 'banned-players.json':
			return [
				{ key: 'uuid', label: 'UUID', kind: 'string' },
				{ key: 'name', label: 'Name', kind: 'string' },
				{ key: 'created', label: 'Created', kind: 'string' },
				{ key: 'source', label: 'Source', kind: 'string' },
				{ key: 'expires', label: 'Expires', kind: 'string' },
				{ key: 'reason', label: 'Reason', kind: 'string' },
			];
		default:
			return [];
	}
};

export const parseJsonRecordList = (content: string) => {
	const parsed = JSON.parse(content) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error('JSON config files must contain an array of records.');
	}

	return parsed.map((entry, index) => {
		if (!isRecord(entry)) {
			throw new Error(`JSON record ${index + 1} must be an object.`);
		}

		return entry;
	});
};

export const inferJsonColumns = (records: JsonRecord[], fileName: string): JsonColumn[] => {
	const defaults = defaultJsonColumnsForFile(fileName);
	const defaultKeyOrder = defaults.map((column) => column.key);
	const defaultKeySet = new Set(defaultKeyOrder);
	const columns = new Map<string, JsonColumn>();

	for (const column of defaults) {
		columns.set(column.key, { ...column });
	}

	for (const record of records) {
		for (const [key, value] of Object.entries(record)) {
			const existing = columns.get(key);
			const kind = getJsonValueKind(value);

			if (existing) {
				if (existing.kind !== kind) {
					columns.set(key, { ...existing, kind: inferJsonColumnKind(records, key) });
				}
				continue;
			}

			columns.set(key, { key, label: prettifyKey(key), kind });
		}
	}

	const orderedKeys = [
		...defaultKeyOrder,
		...Array.from(columns.keys())
			.filter((key) => !defaultKeySet.has(key))
			.sort((left, right) => left.localeCompare(right)),
	];

	return orderedKeys
		.map((key) => columns.get(key))
		.filter((column): column is JsonColumn => Boolean(column));
};

export const jsonColumnDefaultValue = (kind: JsonColumnKind) => {
	switch (kind) {
		case 'number':
			return '0';
		case 'boolean':
			return 'false';
		case 'json':
			return '{}';
		default:
			return '';
	}
};

export const stringifyJsonRow = (record: JsonRecord, columns: JsonColumn[]) => {
	const values: PropertyValues = {};
	for (const column of columns) {
		values[column.key] =
			stringifyStructuredValue(record[column.key]) || jsonColumnDefaultValue(column.kind);
	}

	for (const [key, value] of Object.entries(record)) {
		if (values[key] !== undefined) continue;
		values[key] = stringifyStructuredValue(value);
	}

	return values;
};

export const parseJsonCellValue = (kind: JsonColumnKind, value: string) => {
	switch (kind) {
		case 'number': {
			const parsed = Number(value.trim());
			if (!Number.isFinite(parsed)) {
				throw new Error('Numeric values must contain a valid number.');
			}
			return parsed;
		}
		case 'boolean':
			return value.trim().toLowerCase() === 'true';
		case 'json': {
			const trimmed = value.trim();
			if (!trimmed) return {};
			return JSON.parse(trimmed) as unknown;
		}
		default:
			return value;
	}
};

export const createJsonRows = (records: JsonRecord[], columns: JsonColumn[]): JsonRow[] =>
	records.map((record) => ({
		id: makeRowId(),
		values: stringifyJsonRow(record, columns),
	}));

export const areJsonRowsEqual = (left: JsonRow[], right: JsonRow[]) => {
	if (left.length !== right.length) return false;

	for (let index = 0; index < left.length; index += 1) {
		if (!sameStringRecord(left[index].values, right[index].values)) return false;
	}

	return true;
};

export const jsonRowsToRecords = (rows: JsonRow[], columns: JsonColumn[]) => {
	const columnKeys = new Set(columns.map((column) => column.key));

	return rows.map((row) => {
		const record: JsonRecord = {};

		for (const column of columns) {
			record[column.key] = parseJsonCellValue(column.kind, row.values[column.key] ?? '');
		}

		for (const [key, value] of Object.entries(row.values)) {
			if (columnKeys.has(key)) continue;
			record[key] = value;
		}

		return record;
	});
};
