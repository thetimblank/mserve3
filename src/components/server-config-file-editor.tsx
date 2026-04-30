import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Info, Loader, Plus, RefreshCcw, Save, Trash } from 'lucide-react';
import { toast } from 'sonner';
import * as TOML from '@iarna/toml';
import * as YAML from 'yaml';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { UserData, useUser } from '@/data/user';
import {
	type ManagedConfigFileReadPayload,
	type ManagedConfigFileReadResult,
	type ManagedConfigFileWritePayload,
	type ManagedConfigPropertyDefinition,
	type ManagedServerConfigFileDefinition,
} from '@/lib/server-config-files';

type ServerConfigFileEditorProps = {
	serverDirectory: string;
	definition: ManagedServerConfigFileDefinition;
	disabled?: boolean;
	onSaved?: () => Promise<void> | void;
};

type PropertyValues = Record<string, string>;
type TomlRoot = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;
type JsonRow = {
	id: string;
	values: PropertyValues;
};
type JsonColumnKind = 'string' | 'number' | 'boolean' | 'json';
type JsonColumn = {
	key: string;
	label: string;
	kind: JsonColumnKind;
};
type TomlValueKind = 'string' | 'number' | 'boolean' | 'list' | 'json';

const UNSAVED_TOAST_STYLE = {
	'--width': 'min(32rem, calc(100vw - 2rem))',
} as React.CSSProperties;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const makeRowId = () => `json-row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const prettifyKey = (key: string) =>
	key
		.split(/[-_.]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');

const sameStringRecord = (left: PropertyValues, right: PropertyValues) => {
	const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
	const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) =>
		leftKey.localeCompare(rightKey),
	);
	return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
};

const stringifyStructuredValue = (value: unknown): string => {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (Array.isArray(value)) return value.map((entry) => stringifyStructuredValue(entry)).join('\n');
	if (isRecord(value)) return JSON.stringify(value, null, 2);
	return String(value);
};

const inferJsonColumnKind = (records: JsonRecord[], key: string): JsonColumnKind => {
	let resolvedKind: JsonColumnKind | null = null;

	for (const record of records) {
		if (!(key in record)) continue;
		const value = record[key];
		const nextKind: JsonColumnKind =
			typeof value === 'number'
				? 'number'
				: typeof value === 'boolean'
					? 'boolean'
					: isRecord(value) || Array.isArray(value)
						? 'json'
						: 'string';

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

const parseJsonRecordList = (content: string) => {
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

const inferJsonColumns = (records: JsonRecord[], fileName: string): JsonColumn[] => {
	const defaults = defaultJsonColumnsForFile(fileName);
	const defaultKeyOrder = defaults.map((column) => column.key);
	const columns = new Map<string, JsonColumn>();

	for (const column of defaults) {
		columns.set(column.key, { ...column });
	}

	for (const record of records) {
		for (const [key, value] of Object.entries(record)) {
			const existing = columns.get(key);
			const kind: JsonColumnKind =
				typeof value === 'number'
					? 'number'
					: typeof value === 'boolean'
						? 'boolean'
						: isRecord(value) || Array.isArray(value)
							? 'json'
							: 'string';

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
			.filter((key) => !defaultKeyOrder.includes(key))
			.sort((left, right) => left.localeCompare(right)),
	];

	return orderedKeys
		.map((key) => columns.get(key))
		.filter((column): column is JsonColumn => Boolean(column));
};

const jsonColumnDefaultValue = (kind: JsonColumnKind) => {
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

const stringifyJsonRow = (record: JsonRecord, columns: JsonColumn[]) => {
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

const parseJsonCellValue = (kind: JsonColumnKind, value: string) => {
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

const parseTomlValue = (templateValue: unknown, value: string): unknown => {
	if (typeof templateValue === 'number') {
		const parsed = Number(value.trim());
		if (!Number.isFinite(parsed)) {
			throw new Error('Numeric values must contain a valid number.');
		}
		return parsed;
	}

	if (typeof templateValue === 'boolean') {
		return value.trim().toLowerCase() === 'true';
	}

	if (Array.isArray(templateValue)) {
		return value
			.split(/\r?\n/)
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	if (isRecord(templateValue)) {
		const trimmed = value.trim();
		if (!trimmed) return {};
		const parsed = JSON.parse(trimmed) as unknown;
		if (!isRecord(parsed)) {
			throw new Error('Advanced TOML object values must be valid JSON objects.');
		}
		return parsed;
	}

	return value;
};

const inferTomlValueKind = (value: unknown): TomlValueKind => {
	if (typeof value === 'number') return 'number';
	if (typeof value === 'boolean') return 'boolean';
	if (Array.isArray(value)) return 'list';
	if (isRecord(value)) return 'json';
	return 'string';
};

const tomlValueToString = (value: unknown): string => {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (Array.isArray(value)) return value.map((entry) => tomlValueToString(entry)).join('\n');
	if (isRecord(value)) return JSON.stringify(value, null, 2);
	return String(value);
};

const toErrorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const defaultValueToString = (value: ManagedConfigPropertyDefinition['defaultValue']) => {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (Array.isArray(value)) return value.map((entry) => String(entry)).join('\n');
	if (isRecord(value)) return JSON.stringify(value, null, 2);
	return '';
};

const normalizeJsonContent = (content: string) => `${JSON.stringify(JSON.parse(content), null, 2)}\n`;

const normalizeYamlContent = (content: string) => {
	const parsed = YAML.parse(content);
	return `${YAML.stringify(parsed).trimEnd()}\n`;
};

const normalizeTomlContent = (content: string) => `${TOML.stringify(TOML.parse(content)).trimEnd()}\n`;

const parsePropertiesMap = (content: string) => {
	const values = new Map<string, string>();

	for (const rawLine of content.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
			continue;
		}

		const equalsIndex = rawLine.indexOf('=');
		const colonIndex = rawLine.indexOf(':');
		let separatorIndex = -1;

		if (equalsIndex >= 0 && colonIndex >= 0) {
			separatorIndex = Math.min(equalsIndex, colonIndex);
		} else {
			separatorIndex = equalsIndex >= 0 ? equalsIndex : colonIndex;
		}

		if (separatorIndex < 0) {
			throw new Error(`Invalid properties line: ${rawLine}`);
		}

		const key = rawLine.slice(0, separatorIndex).trim();
		const value = rawLine.slice(separatorIndex + 1).trim();
		if (!key) {
			throw new Error(`Invalid properties line: ${rawLine}`);
		}

		values.set(key, value);
	}

	return values;
};

const serializePropertiesMap = (values: Map<string, string>, featuredKeys: string[]) => {
	const orderedKeys: string[] = [];

	for (const key of featuredKeys) {
		if (values.has(key) && !orderedKeys.includes(key)) {
			orderedKeys.push(key);
		}
	}

	for (const key of Array.from(values.keys()).sort((left, right) => left.localeCompare(right))) {
		if (!orderedKeys.includes(key)) {
			orderedKeys.push(key);
		}
	}

	return `${orderedKeys.map((key) => `${key}=${values.get(key) ?? ''}`).join('\n')}\n`;
};

const createPropertyValues = (
	properties: ManagedConfigPropertyDefinition[],
	rawValues: Record<string, unknown>,
): PropertyValues => {
	const nextValues: PropertyValues = {};

	for (const property of properties) {
		const rawValue = rawValues[property.key];
		if (typeof rawValue === 'string') {
			nextValues[property.key] = rawValue;
			continue;
		}

		if (typeof rawValue === 'number') {
			nextValues[property.key] = String(rawValue);
			continue;
		}

		if (typeof rawValue === 'boolean') {
			nextValues[property.key] = rawValue ? 'true' : 'false';
			continue;
		}

		if (Array.isArray(rawValue)) {
			nextValues[property.key] = rawValue.map((entry) => String(entry)).join('\n');
			continue;
		}

		if (isRecord(rawValue)) {
			nextValues[property.key] = JSON.stringify(rawValue, null, 2);
			continue;
		}

		nextValues[property.key] = defaultValueToString(property.defaultValue);
	}

	return nextValues;
};

const parsePropertyNumber = (property: ManagedConfigPropertyDefinition, value: string) => {
	const parsed = Number(value.trim());
	if (!Number.isInteger(parsed)) {
		throw new Error(`${property.label} must be a whole number.`);
	}

	if (property.key === 'server-port' && (parsed < 1 || parsed > 65535)) {
		throw new Error('Server port must be between 1 and 65535.');
	}

	if (property.key === 'spawn-protection' && parsed < 0) {
		throw new Error('Spawn protection must be 0 or greater.');
	}

	if (parsed < 0) {
		throw new Error(`${property.label} must be 0 or greater.`);
	}

	return String(parsed);
};

const renderHeader = (
	definition: ManagedServerConfigFileDefinition,
	isDirty: boolean,
	onReload: () => Promise<void> | void,
	disabled: boolean,
) => (
	<div className='flex flex-wrap items-start justify-between gap-4'>
		<div className='space-y-1'>
			<p className='text-xl font-semibold'>{definition.title}</p>
			<p className='text-sm text-muted-foreground'>{definition.description}</p>
		</div>
		<div className='flex flex-wrap items-center gap-2'>
			{isDirty && (
				<span className='rounded-md border-2 font-semibold border-destructive px-3 text-sm py-1 text-destructive'>
					Unsaved
				</span>
			)}
			<Button type='button' variant='secondary' onClick={onReload} disabled={disabled}>
				<RefreshCcw />
				Reload
			</Button>
		</div>
	</div>
);

const renderNetworkingDisclaimer = (user: UserData, definition: ManagedServerConfigFileDefinition) => {
	if (!definition.networkingDisclaimer || !user.advanced_mode) return null;

	return (
		<div className='rounded-md border-2 border-warning bg-warning/10 font-semibold p-4 text-sm text-warning-foreground flex gap-3 items-center'>
			<Info className='text-warning-foreground size-8 shrink-0' />
			<div>
				Server networking is automatically managed by MSERVE. You may still enter values when in{' '}
				<Link to='/settings' className='font-medium text-foreground underline underline-offset-4'>
					advanced mode
				</Link>{' '}
				to override mserve's automatic networking (not recommended).
			</div>
		</div>
	);
};

const renderAdvancedModeDisclaimer = (user: UserData) => {
	if (user.advanced_mode) {
		return (
			<div className='rounded-md border-2 border-warning bg-warning/10 font-semibold p-4 text-sm text-warning-foreground flex gap-3 items-center'>
				<Info className='text-warning-foreground size-8 shrink-0' />
				<div>
					You have advanced mode enabled. Certain properties that may be dangerous to modify are now
					shown because{' '}
					<Link to='/settings' className='font-medium text-foreground underline underline-offset-4'>
						advanced mode
					</Link>{' '}
					is turned on.
				</div>
			</div>
		);
	}

	return (
		<div className='rounded-md border-2 bg-muted font-semibold p-4 text-sm text-foreground flex gap-3 items-center'>
			<Info className='text-foreground size-8 shrink-0' />
			<div>
				Certain properties are hidden that you can only access when{' '}
				<Link to='/settings' className='font-medium text-foreground underline underline-offset-4'>
					advanced mode
				</Link>{' '}
				is turned on. (not recommended for inexperienced hosts)
			</div>
		</div>
	);
};

const useUnsavedChangesToast = ({
	toastId,
	isDirty,
	isLocked,
	isSaving,
	onReset,
	onSave,
}: {
	toastId: string;
	isDirty: boolean;
	isLocked: boolean;
	isSaving: boolean;
	onReset: () => void;
	onSave: () => Promise<void>;
}) => {
	React.useEffect(() => {
		if (isLocked || !isDirty) {
			toast.dismiss(toastId);
			return;
		}

		toast('You have unsaved changes', {
			id: toastId,
			duration: Number.POSITIVE_INFINITY,
			dismissible: false,
			style: UNSAVED_TOAST_STYLE,
			action: (
				<div className='ml-auto flex items-center gap-2'>
					<Button type='button' variant='destructive-secondary' onClick={onReset}>
						<Trash className='size-4' /> Reset
					</Button>
					<Button type='button' onClick={() => void onSave()}>
						{isSaving ? <Loader className='size-4 animate-spin' /> : <Save className='size-4' />}
						{isSaving ? 'Saving...' : 'Save file'}
					</Button>
				</div>
			),
		});
	}, [isDirty, isLocked, isSaving, onReset, onSave, toastId]);
};

const JsonArrayConfigFileEditor: React.FC<ServerConfigFileEditorProps> = ({
	serverDirectory,
	definition,
	disabled,
	onSaved,
}) => {
	const [columns, setColumns] = React.useState<JsonColumn[]>([]);
	const [rows, setRows] = React.useState<JsonRow[]>([]);
	const [originalRows, setOriginalRows] = React.useState<JsonRow[]>([]);
	const [isLoading, setIsLoading] = React.useState(true);
	const [isSaving, setIsSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [isSelectionMode, setIsSelectionMode] = React.useState(false);
	const [selectedRowIds, setSelectedRowIds] = React.useState<string[]>([]);
	const [currentPage, setCurrentPage] = React.useState(1);
	const { user } = useUser();
	const pageSize = 10;

	const isLocked = Boolean(disabled || isLoading || isSaving);
	const isDirty = React.useMemo(
		() =>
			JSON.stringify(rows.map((row) => row.values)) !==
			JSON.stringify(originalRows.map((row) => row.values)),
		[originalRows, rows],
	);
	const toastId = React.useMemo(
		() => `managed-config-${serverDirectory}-${definition.fileName}`,
		[definition.fileName, serverDirectory],
	);

	const loadContent = React.useCallback(async () => {
		if (!serverDirectory.trim()) return;

		setIsLoading(true);
		setError(null);
		try {
			const result = await invoke<ManagedConfigFileReadResult>('read_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
				} as ManagedConfigFileReadPayload,
			});

			const parsedRecords = parseJsonRecordList(result.content);
			const nextColumns = inferJsonColumns(parsedRecords, definition.fileName);
			const nextRows = parsedRecords.map((record) => ({
				id: makeRowId(),
				values: stringifyJsonRow(record, nextColumns),
			}));

			setColumns(nextColumns);
			setRows(nextRows);
			setOriginalRows(nextRows);
			setSelectedRowIds([]);
			setIsSelectionMode(false);
			setCurrentPage(1);
		} catch (err) {
			setError(toErrorMessage(err, `Could not load ${definition.fileName}.`));
		} finally {
			setIsLoading(false);
		}
	}, [definition.fileName, serverDirectory]);

	React.useEffect(() => {
		void loadContent();
	}, [loadContent]);

	const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
	React.useEffect(() => {
		setCurrentPage((page) => Math.min(page, totalPages));
	}, [totalPages]);

	const visibleRows = React.useMemo(() => {
		const startIndex = (currentPage - 1) * pageSize;
		return rows.slice(startIndex, startIndex + pageSize);
	}, [currentPage, rows]);

	const selectedRowIdSet = React.useMemo(() => new Set(selectedRowIds), [selectedRowIds]);
	const allVisibleSelected =
		visibleRows.length > 0 && visibleRows.every((row) => selectedRowIdSet.has(row.id));
	const selectedCount = selectedRowIds.length;

	const handleReset = React.useCallback(() => {
		setRows(originalRows);
		setError(null);
		setSelectedRowIds([]);
		setIsSelectionMode(false);
		setCurrentPage(1);
	}, [originalRows]);

	const handleReload = React.useCallback(async () => {
		await loadContent();
	}, [loadContent]);

	const updateRowValue = React.useCallback((rowId: string, key: string, value: string) => {
		setRows((previous) =>
			previous.map((row) =>
				row.id === rowId ? { ...row, values: { ...row.values, [key]: value } } : row,
			),
		);
		setError(null);
	}, []);

	const handleAddRow = React.useCallback(() => {
		setRows((previous) => {
			const templateValues: PropertyValues = {};
			for (const column of columns) {
				templateValues[column.key] = jsonColumnDefaultValue(column.kind);
			}

			const nextRows = [...previous, { id: makeRowId(), values: templateValues }];
			setCurrentPage(Math.max(1, Math.ceil(nextRows.length / pageSize)));
			return nextRows;
		});
		setError(null);
	}, [columns]);

	const toggleRowSelection = React.useCallback((rowId: string, selected: boolean) => {
		setSelectedRowIds((previous) => {
			const next = new Set(previous);
			if (selected) {
				next.add(rowId);
			} else {
				next.delete(rowId);
			}
			return Array.from(next);
		});
	}, []);

	const toggleSelectionMode = React.useCallback(() => {
		setIsSelectionMode((previous) => {
			const next = !previous;
			if (!next) {
				setSelectedRowIds([]);
			}
			return next;
		});
	}, []);

	const toggleSelectVisibleRows = React.useCallback(
		(selected: boolean) => {
			setSelectedRowIds((previous) => {
				const next = new Set(previous);
				for (const row of visibleRows) {
					if (selected) {
						next.add(row.id);
					} else {
						next.delete(row.id);
					}
				}
				return Array.from(next);
			});
		},
		[visibleRows],
	);

	const deleteRows = React.useCallback((rowIds: string[]) => {
		setRows((previous) => previous.filter((row) => !rowIds.includes(row.id)));
		setSelectedRowIds((previous) => previous.filter((rowId) => !rowIds.includes(rowId)));
		setCurrentPage(1);
		setError(null);
		toggleSelectionMode();
	}, []);

	const handleSave = React.useCallback(async () => {
		if (isLocked) return;

		setError(null);
		setIsSaving(true);
		try {
			const normalizedRecords = rows.map((row) => {
				const record: JsonRecord = {};

				for (const column of columns) {
					record[column.key] = parseJsonCellValue(column.kind, row.values[column.key] ?? '');
				}

				for (const [key, value] of Object.entries(row.values)) {
					if (columns.some((column) => column.key === key)) {
						continue;
					}
					record[key] = value;
				}

				return record;
			});

			const normalizedContent = `${JSON.stringify(normalizedRecords, null, 2)}\n`;
			const result = await invoke<ManagedConfigFileReadResult>('write_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
					content: normalizedContent,
				} as ManagedConfigFileWritePayload,
			});

			const parsedRecords = parseJsonRecordList(result.content);
			const nextColumns = inferJsonColumns(parsedRecords, definition.fileName);
			const nextRows = parsedRecords.map((record) => ({
				id: makeRowId(),
				values: stringifyJsonRow(record, nextColumns),
			}));

			setColumns(nextColumns);
			setRows(nextRows);
			setOriginalRows(nextRows);
			setSelectedRowIds([]);
			setIsSelectionMode(false);
			setCurrentPage(1);
			toast.success(`${definition.title} saved.`);
			await onSaved?.();
		} catch (err) {
			setError(toErrorMessage(err, `Could not save ${definition.fileName}.`));
		} finally {
			setIsSaving(false);
		}
	}, [columns, definition.fileName, definition.title, isLocked, onSaved, rows, serverDirectory]);

	useUnsavedChangesToast({
		toastId,
		isDirty,
		isLocked,
		isSaving,
		onReset: handleReset,
		onSave: handleSave,
	});

	return (
		<div className='space-y-6'>
			{renderHeader(definition, isDirty, handleReload, isLocked)}
			{renderNetworkingDisclaimer(user, definition)}
			<div className='space-y-4'>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div className='flex flex-wrap items-center gap-2'>
						<Button type='button' variant='secondary' onClick={handleAddRow} disabled={isLocked}>
							<Plus />
							Add item
						</Button>
						<Button
							type='button'
							variant={'secondary'}
							onClick={
								selectedCount > 0 && isSelectionMode
									? () => deleteRows(selectedRowIds)
									: toggleSelectionMode
							}
							disabled={isLocked}>
							<Trash />
							{isSelectionMode
								? selectedCount > 0
									? `Delete selected (${selectedCount})`
									: 'Cancel Mass remove'
								: 'Mass remove'}
						</Button>
					</div>
				</div>

				{isLoading ? (
					<div className='flex items-center gap-2 text-sm text-muted-foreground'>
						<Loader className='size-4 animate-spin' />
						<span>Loading file contents...</span>
					</div>
				) : rows.length > 0 ? (
					<div className='space-y-3'>
						<div className='flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground'>
							<span>
								Showing {Math.min(rows.length, (currentPage - 1) * pageSize + 1)}-
								{Math.min(rows.length, currentPage * pageSize)} of {rows.length}
							</span>
							<div className='flex items-center gap-2'>
								<Button
									type='button'
									variant='secondary'
									size='sm'
									onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
									disabled={isLocked || currentPage <= 1}>
									<ChevronLeft />
									Previous
								</Button>
								<span className='min-w-24 text-center font-medium text-foreground'>
									Page {currentPage} of {totalPages}
								</span>
								<Button
									type='button'
									variant='secondary'
									size='sm'
									onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
									disabled={isLocked || currentPage >= totalPages}>
									Next
									<ChevronRight />
								</Button>
							</div>
						</div>

						<div className='overflow-x-auto rounded-lg border'>
							<table className='w-full text-sm'>
								<thead className='bg-secondary/50 text-left'>
									<tr>
										{isSelectionMode && (
											<th className='w-12 px-3 py-2'>
												<Checkbox
													checked={allVisibleSelected && visibleRows.length > 0}
													onCheckedChange={(checked) =>
														toggleSelectVisibleRows(checked === true)
													}
													disabled={isLocked || visibleRows.length === 0}
												/>
											</th>
										)}
										{columns.map((column) => (
											<th key={column.key} className='px-3 py-2'>
												{column.label}
											</th>
										))}
										<th className='px-3 py-2 text-right'>Actions</th>
									</tr>
								</thead>
								<tbody>
									{visibleRows.map((row) => {
										const selected = selectedRowIdSet.has(row.id);

										return (
											<tr key={row.id} className={selected ? 'bg-accent/20' : 'border-t'}>
												{isSelectionMode && (
													<td className='px-3 py-2 align-top'>
														<Checkbox
															checked={selected}
															onCheckedChange={(checked) =>
																toggleRowSelection(row.id, checked === true)
															}
															disabled={isLocked}
														/>
													</td>
												)}
												{columns.map((column) => (
													<td key={`${row.id}-${column.key}`} className='px-3 py-2 align-top'>
														{column.kind === 'boolean' ? (
															<Checkbox
																checked={
																	(row.values[column.key] ?? '').trim().toLowerCase() ===
																	'true'
																}
																onCheckedChange={(checked) =>
																	updateRowValue(
																		row.id,
																		column.key,
																		checked === true ? 'true' : 'false',
																	)
																}
																disabled={isLocked}
															/>
														) : column.kind === 'number' ? (
															<Input
																type='number'
																value={row.values[column.key] ?? ''}
																onChange={(event) =>
																	updateRowValue(row.id, column.key, event.target.value)
																}
																disabled={isLocked}
																className='min-w-24'
															/>
														) : column.kind === 'json' ? (
															<Textarea
																value={row.values[column.key] ?? ''}
																onChange={(event) =>
																	updateRowValue(row.id, column.key, event.target.value)
																}
																disabled={isLocked}
																spellCheck={false}
																className='min-h-24 min-w-56 font-mono text-xs'
															/>
														) : (
															<Input
																value={row.values[column.key] ?? ''}
																onChange={(event) =>
																	updateRowValue(row.id, column.key, event.target.value)
																}
																disabled={isLocked}
																className='min-w-40'
															/>
														)}
													</td>
												))}
												<td className='px-3 py-2 align-top text-right'>
													<Button
														type='button'
														variant='destructive-secondary'
														size='sm'
														onClick={() => deleteRows([row.id])}
														disabled={isLocked}>
														<Trash />
														Remove
													</Button>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</div>
				) : (
					<div className='rounded-lg border-2 border-dashed p-8 text-center text-sm text-muted-foreground'>
						This file is empty. Add the first record to begin.
					</div>
				)}
			</div>
			{error && <p className='text-sm text-destructive'>{error}</p>}
		</div>
	);
};

const MotdPreview: React.FC<{ value: string }> = ({ value }) => {
	const lines = value.split(/\r?\n/);
	return (
		<div className='rounded-md bg-neutral-900 px-4 py-3 text-sm leading-relaxed text-white shadow-inner font-minecraft'>
			{lines.length > 0 ? (
				lines.map((line, index) => (
					<div key={`${index}-${line}`} className='min-h-5'>
						{line.length > 0 ? line : '\u00a0'}
					</div>
				))
			) : (
				<div className='text-white/50'>Your MOTD preview will appear here.</div>
			)}
		</div>
	);
};

const propertyLabel = (property: ManagedConfigPropertyDefinition) => (
	<span className='flex items-center gap-2'>
		{/* <Star className='size-4 shrink-0 fill-warning text-warning' /> */}
		<span>{property.label}</span>
	</span>
);

const PropertyField: React.FC<{
	property: ManagedConfigPropertyDefinition;
	value: string;
	onChange: (nextValue: string) => void;
	disabled?: boolean;
}> = ({ property, value, onChange, disabled }) => {
	const { user } = useUser();
	const id = `managed-config-${property.key}`;

	if (property.network && !user.advanced_mode) return null;

	if (property.type === 'boolean') {
		return (
			<div className='space-y-2 max-w-lg'>
				<Label className='text-xl'>{propertyLabel(property)}</Label>
				<p className='text-sm text-muted-foreground'>{property.description}</p>
				<Label className='flex items-center gap-3'>
					<Checkbox
						id={id}
						checked={value.trim().toLowerCase() === 'true'}
						onCheckedChange={(checked) => onChange(checked === true ? 'true' : 'false')}
						disabled={disabled}
					/>
					Enabled
				</Label>
			</div>
		);
	}

	if (property.type === 'number') {
		const min = property.key === 'spawn-protection' ? 0 : 1;

		return (
			<div className='space-y-2 max-w-lg'>
				<Label htmlFor={id} className='text-xl'>
					{propertyLabel(property)}
				</Label>
				<p className='text-sm text-muted-foreground'>{property.description}</p>
				<InputGroup>
					<InputGroupInput
						id={id}
						type='number'
						min={min}
						max={property.key === 'server-port' ? 65535 : undefined}
						value={value}
						onChange={(event) => onChange(event.target.value)}
						disabled={disabled}
					/>
					<InputGroupAddon className='font-mono font-bold uppercase text-xs' align='inline-end'>
						{property.unitLabel ?? 'Units'}
					</InputGroupAddon>
				</InputGroup>
			</div>
		);
	}

	if (property.type === 'enum') {
		return (
			<div className='space-y-2 max-w-lg'>
				<Label htmlFor={id} className='text-xl'>
					{propertyLabel(property)}
				</Label>
				<p className='text-sm text-muted-foreground'>{property.description}</p>
				<Select value={value} onValueChange={onChange} disabled={disabled}>
					<SelectTrigger id={id} className='w-full'>
						<SelectValue placeholder='Select an option' />
					</SelectTrigger>
					<SelectContent>
						{property.options?.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		);
	}

	if (property.type === 'list') {
		return (
			<div className='space-y-2 max-w-lg'>
				<Label htmlFor={id} className='text-xl'>
					{propertyLabel(property)}
				</Label>
				<p className='text-sm text-muted-foreground'>{property.description}</p>
				<Textarea
					id={id}
					className='min-h-40 font-mono text-sm'
					value={value}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
					spellCheck={false}
				/>
			</div>
		);
	}

	if (property.type === 'map') {
		return (
			<div className='space-y-2 max-w-lg'>
				<Label htmlFor={id} className='text-xl'>
					{propertyLabel(property)}
				</Label>
				<p className='text-sm text-muted-foreground'>{property.description}</p>
				<Textarea
					id={id}
					className='min-h-40 font-mono text-sm'
					value={value}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
					spellCheck={false}
				/>
			</div>
		);
	}

	return (
		<div className='space-y-2 max-w-lg'>
			<Label htmlFor={id} className='text-xl'>
				{propertyLabel(property)}
			</Label>
			<p className='text-sm text-muted-foreground'>{property.description}</p>
			{property.multiline ? (
				<>
					<Textarea
						id={id}
						className='min-h-28 font-mono text-sm'
						value={value}
						onChange={(event) => onChange(event.target.value)}
						disabled={disabled}
						spellCheck={false}
					/>
					{property.key === 'motd' && <MotdPreview value={value} />}
				</>
			) : (
				<Input
					id={id}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
				/>
			)}
		</div>
	);
};

const PlainTextConfigFileEditor: React.FC<ServerConfigFileEditorProps> = ({
	serverDirectory,
	definition,
	disabled,
	onSaved,
}) => {
	const [content, setContent] = React.useState('');
	const [originalContent, setOriginalContent] = React.useState('');
	const [isLoading, setIsLoading] = React.useState(true);
	const [isSaving, setIsSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const { user } = useUser();

	const isLocked = Boolean(disabled || isLoading || isSaving);
	const isDirty = content !== originalContent;
	const toastId = React.useMemo(
		() => `managed-config-${serverDirectory}-${definition.fileName}`,
		[definition.fileName, serverDirectory],
	);

	const loadContent = React.useCallback(async () => {
		if (!serverDirectory.trim()) return;

		setIsLoading(true);
		setError(null);
		try {
			const result = await invoke<ManagedConfigFileReadResult>('read_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
				} as ManagedConfigFileReadPayload,
			});
			setContent(result.content);
			setOriginalContent(result.content);
		} catch (err) {
			setError(toErrorMessage(err, `Could not load ${definition.fileName}.`));
		} finally {
			setIsLoading(false);
		}
	}, [definition.fileName, serverDirectory]);

	React.useEffect(() => {
		void loadContent();
	}, [loadContent]);

	const handleReset = React.useCallback(() => {
		setContent(originalContent);
		setError(null);
	}, [originalContent]);

	const handleReload = React.useCallback(async () => {
		await loadContent();
	}, [loadContent]);

	const handleSave = React.useCallback(async () => {
		if (isLocked) return;

		setError(null);
		setIsSaving(true);
		try {
			let normalizedContent = content;
			switch (definition.format) {
				case 'json':
					normalizedContent = normalizeJsonContent(content);
					break;
				case 'yaml':
					normalizedContent = normalizeYamlContent(content);
					break;
				case 'toml':
					normalizedContent = normalizeTomlContent(content);
					break;
				default:
					break;
			}

			const result = await invoke<ManagedConfigFileReadResult>('write_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
					content: normalizedContent,
				} as ManagedConfigFileWritePayload,
			});

			setContent(result.content);
			setOriginalContent(result.content);
			toast.success(`${definition.title} saved.`);
			await onSaved?.();
		} catch (err) {
			setError(toErrorMessage(err, `Could not save ${definition.fileName}.`));
		} finally {
			setIsSaving(false);
		}
	}, [content, definition, isLocked, onSaved, serverDirectory]);

	useUnsavedChangesToast({
		toastId,
		isDirty,
		isLocked,
		isSaving,
		onReset: handleReset,
		onSave: handleSave,
	});

	return (
		<div className='space-y-6'>
			{renderHeader(definition, isDirty, handleReload, isLocked)}
			{renderNetworkingDisclaimer(user, definition)}
			{isLoading ? (
				<div className='flex items-center gap-2 text-sm text-muted-foreground'>
					<Loader className='size-4 animate-spin' />
					<span>Loading file contents...</span>
				</div>
			) : (
				<Textarea
					className='min-h-120 font-mono text-sm'
					value={content}
					onChange={(event) => {
						setContent(event.target.value);
						setError(null);
					}}
					disabled={isLocked}
					spellCheck={false}
				/>
			)}
			{error && <p className='text-sm text-destructive'>{error}</p>}
		</div>
	);
};

const ServerPropertiesFileEditor: React.FC<ServerConfigFileEditorProps> = ({
	serverDirectory,
	definition,
	disabled,
	onSaved,
}) => {
	const { user } = useUser();
	const [values, setValues] = React.useState<PropertyValues>({});
	const [originalValues, setOriginalValues] = React.useState<PropertyValues>({});
	const [sourceValues, setSourceValues] = React.useState<Map<string, string>>(new Map());
	const [isLoading, setIsLoading] = React.useState(true);
	const [isSaving, setIsSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const isLocked = Boolean(disabled || isLoading || isSaving);
	const isDirty = React.useMemo(() => !sameStringRecord(values, originalValues), [originalValues, values]);
	const featuredKeySet = React.useMemo(
		() => new Set(definition.featuredProperties.map((property) => property.key)),
		[definition.featuredProperties],
	);
	const advancedPropertyKeys = React.useMemo(
		() => Array.from(sourceValues.keys()).filter((key) => !featuredKeySet.has(key)),
		[featuredKeySet, sourceValues],
	);
	const toastId = React.useMemo(
		() => `managed-config-${serverDirectory}-${definition.fileName}`,
		[definition.fileName, serverDirectory],
	);

	const loadContent = React.useCallback(async () => {
		if (!serverDirectory.trim()) return;

		setIsLoading(true);
		setError(null);
		try {
			const result = await invoke<ManagedConfigFileReadResult>('read_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
				} as ManagedConfigFileReadPayload,
			});

			const parsedValues = parsePropertiesMap(result.content);
			const nextValues = Object.fromEntries(parsedValues.entries());
			setSourceValues(parsedValues);
			setValues(nextValues);
			setOriginalValues(nextValues);
		} catch (err) {
			setError(toErrorMessage(err, `Could not load ${definition.fileName}.`));
		} finally {
			setIsLoading(false);
		}
	}, [definition.featuredProperties, definition.fileName, serverDirectory]);

	React.useEffect(() => {
		void loadContent();
	}, [loadContent]);

	const handleReset = React.useCallback(() => {
		setValues(originalValues);
		setError(null);
	}, [originalValues]);

	const handleReload = React.useCallback(async () => {
		await loadContent();
	}, [loadContent]);

	const handleSave = React.useCallback(async () => {
		if (isLocked) return;

		setError(null);
		setIsSaving(true);
		try {
			const nextValues = new Map(sourceValues);

			for (const [key, value] of Object.entries(values)) {
				nextValues.set(key, value);
			}

			for (const property of definition.featuredProperties) {
				const currentValue = values[property.key]?.trim() ?? '';

				if (property.type === 'number') {
					nextValues.set(property.key, parsePropertyNumber(property, currentValue));
					continue;
				}

				if (property.type === 'boolean') {
					nextValues.set(property.key, currentValue.toLowerCase() === 'true' ? 'true' : 'false');
					continue;
				}

				if (property.type === 'enum') {
					if (!property.options?.some((option) => option.value === currentValue)) {
						throw new Error(`${property.label} must be one of the supported options.`);
					}
					nextValues.set(property.key, currentValue);
					continue;
				}

				if (property.type === 'string') {
					nextValues.set(property.key, values[property.key] ?? '');
					continue;
				}
			}

			const normalizedContent = serializePropertiesMap(
				nextValues,
				definition.featuredProperties.map((property) => property.key),
			);

			const result = await invoke<ManagedConfigFileReadResult>('write_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
					content: normalizedContent,
				} as ManagedConfigFileWritePayload,
			});

			const parsedValues = parsePropertiesMap(result.content);
			const nextFeaturedValues = Object.fromEntries(parsedValues.entries());
			setSourceValues(parsedValues);
			setValues(nextFeaturedValues);
			setOriginalValues(nextFeaturedValues);
			toast.success(`${definition.title} saved.`);
			await onSaved?.();
		} catch (err) {
			setError(toErrorMessage(err, `Could not save ${definition.fileName}.`));
		} finally {
			setIsSaving(false);
		}
	}, [
		definition.featuredProperties,
		definition.fileName,
		isLocked,
		onSaved,
		serverDirectory,
		sourceValues,
		values,
	]);

	useUnsavedChangesToast({
		toastId,
		isDirty,
		isLocked,
		isSaving,
		onReset: handleReset,
		onSave: handleSave,
	});

	return (
		<div className='space-y-8'>
			{renderHeader(definition, isDirty, handleReload, isLocked)}
			{renderNetworkingDisclaimer(user, definition)}
			{renderAdvancedModeDisclaimer(user)}
			{definition.featuredProperties.map((property) => (
				<PropertyField
					key={property.key}
					property={property}
					value={values[property.key] ?? ''}
					onChange={(nextValue) => {
						setValues((prev) => ({ ...prev, [property.key]: nextValue }));
						setError(null);
					}}
					disabled={isLocked}
				/>
			))}
			{user.advanced_mode && advancedPropertyKeys.length > 0 && (
				<section className='space-y-4'>
					<hr className='w-full border-b-2 my-10' />
					<div className='space-y-1'>
						<p className='text-3xl font-semibold'>Advanced properties</p>
						<p className='text-sm text-muted-foreground'>
							All non-featured server.properties entries stay editable here when advanced mode is on.
						</p>
					</div>
					<div className='grid gap-4'>
						{advancedPropertyKeys.map((key) => {
							const value = values[key] ?? '';
							const fieldId = `managed-config-${definition.fileName}-${key}`;
							const multiline = value.includes('\n') || value.length > 120;

							return (
								<div key={key} className='space-y-2 max-w-lg'>
									<Label htmlFor={fieldId} className='text-xl'>
										{prettifyKey(key)}
									</Label>
									<p className='text-sm text-muted-foreground'>Advanced server.properties entry.</p>
									{multiline ? (
										<Textarea
											id={fieldId}
											className='min-h-28 font-mono text-sm'
											value={value}
											onChange={(event) => {
												setValues((previous) => ({ ...previous, [key]: event.target.value }));
												setError(null);
											}}
											disabled={isLocked}
											spellCheck={false}
										/>
									) : (
										<Input
											id={fieldId}
											value={value}
											onChange={(event) => {
												setValues((previous) => ({ ...previous, [key]: event.target.value }));
												setError(null);
											}}
											disabled={isLocked}
										/>
									)}
								</div>
							);
						})}
					</div>
				</section>
			)}
			{error && <p className='text-sm text-destructive'>{error}</p>}
		</div>
	);
};

const VelocityTomlEditor: React.FC<ServerConfigFileEditorProps> = ({
	serverDirectory,
	definition,
	disabled,
	onSaved,
}) => {
	const { user } = useUser();
	const [values, setValues] = React.useState<PropertyValues>({});
	const [originalValues, setOriginalValues] = React.useState<PropertyValues>({});
	const [root, setRoot] = React.useState<TomlRoot>({});
	const [isLoading, setIsLoading] = React.useState(true);
	const [isSaving, setIsSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const isLocked = Boolean(disabled || isLoading || isSaving);
	const isDirty = React.useMemo(() => !sameStringRecord(values, originalValues), [originalValues, values]);
	const featuredKeySet = React.useMemo(
		() => new Set(definition.featuredProperties.map((property) => property.key)),
		[definition.featuredProperties],
	);
	const advancedTomlKeys = React.useMemo(
		() => Object.keys(root).filter((key) => key !== 'servers' && !featuredKeySet.has(key)),
		[featuredKeySet, root],
	);
	const toastId = React.useMemo(
		() => `managed-config-${serverDirectory}-${definition.fileName}`,
		[definition.fileName, serverDirectory],
	);

	const loadContent = React.useCallback(async () => {
		if (!serverDirectory.trim()) return;

		setIsLoading(true);
		setError(null);
		try {
			const result = await invoke<ManagedConfigFileReadResult>('read_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
				} as ManagedConfigFileReadPayload,
			});

			const parsedRoot = TOML.parse(result.content) as TomlRoot;
			const serversTable = isRecord(parsedRoot.servers) ? parsedRoot.servers : {};
			const serverEntries: TomlRoot = { ...serversTable };
			delete serverEntries.try;

			const nextValues: PropertyValues = {};
			const nextRootKeys = Object.keys(parsedRoot).filter((key) => key !== 'servers');
			for (const property of definition.featuredProperties) {
				if (property.key === 'servers') {
					nextValues[property.key] = JSON.stringify(serverEntries, null, 2);
					continue;
				}

				if (property.key === 'try') {
					nextValues[property.key] = Array.isArray(serversTable.try)
						? serversTable.try.map((entry) => String(entry)).join('\n')
						: defaultValueToString(property.defaultValue);
					continue;
				}

				nextValues[property.key] = createPropertyValues([property], {
					[property.key]: parsedRoot[property.key],
				})[property.key];
			}

			for (const key of nextRootKeys) {
				if (featuredKeySet.has(key)) {
					continue;
				}

				nextValues[key] = tomlValueToString(parsedRoot[key]);
			}

			setRoot(parsedRoot);
			setValues(nextValues);
			setOriginalValues(nextValues);
		} catch (err) {
			setError(toErrorMessage(err, `Could not load ${definition.fileName}.`));
		} finally {
			setIsLoading(false);
		}
	}, [definition.featuredProperties, definition.fileName, serverDirectory]);

	React.useEffect(() => {
		void loadContent();
	}, [loadContent]);

	const handleReset = React.useCallback(() => {
		setValues(originalValues);
		setError(null);
	}, [originalValues]);

	const handleReload = React.useCallback(async () => {
		await loadContent();
	}, [loadContent]);

	const parseJsonTextarea = (property: ManagedConfigPropertyDefinition, input: string) => {
		const trimmed = input.trim();
		if (!trimmed) return {};

		const parsed = JSON.parse(trimmed);
		if (!isRecord(parsed)) {
			throw new Error(`${property.label} must be a JSON object.`);
		}

		return parsed;
	};

	const parseListTextarea = (input: string) =>
		input
			.split(/\r?\n/)
			.map((entry) => entry.trim())
			.filter(Boolean);

	const handleSave = React.useCallback(async () => {
		if (isLocked) return;

		setError(null);
		setIsSaving(true);
		try {
			const nextRoot: TomlRoot = { ...root };
			const nextServers = isRecord(nextRoot.servers) ? { ...nextRoot.servers } : {};

			for (const property of definition.featuredProperties) {
				const currentValue = values[property.key]?.trim() ?? '';

				if (property.type === 'number') {
					nextRoot[property.key] = Number.parseInt(parsePropertyNumber(property, currentValue), 10);
					continue;
				}

				if (property.type === 'boolean') {
					nextRoot[property.key] = currentValue.toLowerCase() === 'true';
					continue;
				}

				if (property.type === 'enum') {
					if (!property.options?.some((option) => option.value === currentValue)) {
						throw new Error(`${property.label} must be one of the supported options.`);
					}
					nextRoot[property.key] = currentValue;
					continue;
				}

				if (property.key === 'servers') {
					Object.assign(nextServers, parseJsonTextarea(property, currentValue));
					continue;
				}

				if (property.key === 'try') {
					nextServers.try = parseListTextarea(currentValue);
					continue;
				}

				nextRoot[property.key] = values[property.key] ?? '';
			}

			for (const key of advancedTomlKeys) {
				if (featuredKeySet.has(key) || key === 'servers') {
					continue;
				}

				nextRoot[key] = parseTomlValue(root[key], values[key] ?? '');
			}

			nextRoot.servers = nextServers;
			const normalizedContent = `${TOML.stringify(nextRoot as TOML.JsonMap).trimEnd()}\n`;
			const result = await invoke<ManagedConfigFileReadResult>('write_managed_server_config_file', {
				payload: {
					directory: serverDirectory,
					fileName: definition.fileName,
					content: normalizedContent,
				} as ManagedConfigFileWritePayload,
			});

			const parsedRoot = TOML.parse(result.content) as TomlRoot;
			const serversTable = isRecord(parsedRoot.servers) ? parsedRoot.servers : {};
			const serverEntries: TomlRoot = { ...serversTable };
			delete serverEntries.try;
			const nextValues: PropertyValues = {};
			const nextRootKeys = Object.keys(parsedRoot).filter((key) => key !== 'servers');
			for (const property of definition.featuredProperties) {
				if (property.key === 'servers') {
					nextValues[property.key] = JSON.stringify(serverEntries, null, 2);
					continue;
				}
				if (property.key === 'try') {
					nextValues[property.key] = Array.isArray(serversTable.try)
						? serversTable.try.map((entry) => String(entry)).join('\n')
						: '';
					continue;
				}
				nextValues[property.key] = createPropertyValues([property], {
					[property.key]: parsedRoot[property.key],
				})[property.key];
			}

			for (const key of nextRootKeys) {
				if (featuredKeySet.has(key)) {
					continue;
				}

				nextValues[key] = tomlValueToString(parsedRoot[key]);
			}

			setRoot(parsedRoot);
			setValues(nextValues);
			setOriginalValues(nextValues);
			toast.success(`${definition.title} saved.`);
			await onSaved?.();
		} catch (err) {
			setError(toErrorMessage(err, `Could not save ${definition.fileName}.`));
		} finally {
			setIsSaving(false);
		}
	}, [definition.featuredProperties, definition.fileName, isLocked, onSaved, root, serverDirectory, values]);

	useUnsavedChangesToast({
		toastId,
		isDirty,
		isLocked,
		isSaving,
		onReset: handleReset,
		onSave: handleSave,
	});

	return (
		<div className='space-y-8'>
			{renderHeader(definition, isDirty, handleReload, isLocked)}
			{renderNetworkingDisclaimer(user, definition)}
			{renderAdvancedModeDisclaimer(user)}
			{definition.featuredProperties.map((property) => (
				<PropertyField
					key={property.key}
					property={property}
					value={values[property.key] ?? ''}
					onChange={(nextValue) => {
						setValues((prev) => ({ ...prev, [property.key]: nextValue }));
						setError(null);
					}}
					disabled={isLocked}
				/>
			))}
			{user.advanced_mode && advancedTomlKeys.length > 0 && (
				<section className='space-y-4'>
					<hr className='w-full border-b-2 my-10' />
					<div className='space-y-1'>
						<p className='text-3xl font-semibold'>Advanced properties</p>
						<p className='text-sm text-muted-foreground'>
							All non-featured server.properties entries stay editable here when advanced mode is on.
						</p>
					</div>
					<div className='grid gap-4'>
						{advancedTomlKeys.map((key: string) => {
							const value = values[key] ?? '';
							const kind = inferTomlValueKind(root[key]);
							const fieldId = `managed-config-${definition.fileName}-${key}`;

							return (
								<div key={key} className='space-y-2 max-w-lg'>
									<Label htmlFor={fieldId} className='text-xl'>
										{prettifyKey(key)}
									</Label>
									<p className='text-sm text-muted-foreground'>
										Advanced Velocity configuration entry.
									</p>
									{kind === 'boolean' ? (
										<Label className='flex items-center gap-3'>
											<Checkbox
												checked={value.trim().toLowerCase() === 'true'}
												onCheckedChange={(checked) => {
													setValues((previous) => ({
														...previous,
														[key]: checked === true ? 'true' : 'false',
													}));
													setError(null);
												}}
												disabled={isLocked}
											/>
											Enabled
										</Label>
									) : kind === 'number' ? (
										<Input
											id={fieldId}
											type='number'
											value={value}
											onChange={(event) => {
												setValues((previous) => ({ ...previous, [key]: event.target.value }));
												setError(null);
											}}
											disabled={isLocked}
										/>
									) : kind === 'list' ? (
										<Textarea
											id={fieldId}
											className='min-h-28 font-mono text-sm'
											value={value}
											onChange={(event) => {
												setValues((prev) => ({ ...prev, [key]: event.target.value }));
												setError(null);
											}}
											disabled={isLocked}
											spellCheck={false}
										/>
									) : kind === 'json' ? (
										<Textarea
											id={fieldId}
											className='min-h-28 font-mono text-sm'
											value={value}
											onChange={(event) => {
												setValues((previous) => ({ ...previous, [key]: event.target.value }));
												setError(null);
											}}
											disabled={isLocked}
											spellCheck={false}
										/>
									) : (
										<Input
											id={fieldId}
											value={value}
											onChange={(event) => {
												setValues((prev) => ({ ...prev, [key]: event.target.value }));
												setError(null);
											}}
											disabled={isLocked}
										/>
									)}
								</div>
							);
						})}
					</div>
				</section>
			)}
			{error && <p className='text-sm text-destructive'>{error}</p>}
		</div>
	);
};

export default function ServerConfigFileEditor(props: ServerConfigFileEditorProps) {
	if (props.definition.format === 'json') {
		return <JsonArrayConfigFileEditor {...props} />;
	}

	if (props.definition.kind === 'server-properties') {
		return <ServerPropertiesFileEditor {...props} />;
	}

	if (props.definition.kind === 'velocity-toml') {
		return <VelocityTomlEditor {...props} />;
	}

	return <PlainTextConfigFileEditor {...props} />;
}
