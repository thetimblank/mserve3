import React from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUser } from '@/data/user';

import {
	areJsonRowsEqual,
	createJsonRows,
	inferJsonColumns,
	jsonColumnDefaultValue,
	jsonRowsToRecords,
	parseJsonRecordList,
	validateJsonRecords,
} from './json-config';
import { EditorError, EditorHeader, LoadingFileContents, NetworkingDisclaimer } from './layout';
import type { JsonColumn, JsonRow, PropertyValues, ServerConfigFileEditorProps } from './types';
import { useManagedConfigFile } from './use-managed-config-file';
import { makeRowId, sameStringRecord } from './utils';

const PAGE_SIZE = 10;

const JsonArrayConfigFileEditor: React.FC<ServerConfigFileEditorProps> = (props) => {
	const { definition } = props;
	const [columns, setColumns] = React.useState<JsonColumn[]>([]);
	const [rows, setRows] = React.useState<JsonRow[]>([]);
	const [originalRows, setOriginalRows] = React.useState<JsonRow[]>([]);
	const [isSelectionMode, setIsSelectionMode] = React.useState(false);
	const [selectedRowIds, setSelectedRowIds] = React.useState<string[]>([]);
	const [currentPage, setCurrentPage] = React.useState(1);
	const { user } = useUser();

	const isDirty = React.useMemo(() => !areJsonRowsEqual(rows, originalRows), [originalRows, rows]);

	const { isLoading, isLocked, error, setError, reload } = useManagedConfigFile({
		...props,
		isDirty,
		applyContent: (content) => {
			const parsedRecords = parseJsonRecordList(content);
			const nextColumns = inferJsonColumns(parsedRecords, definition.fileName);
			const nextRows = createJsonRows(parsedRecords, nextColumns);

			setColumns(nextColumns);
			setRows(nextRows);
			setOriginalRows(nextRows);
			setSelectedRowIds([]);
			setIsSelectionMode(false);
			setCurrentPage(1);
		},
		buildContent: () => {
			const records = jsonRowsToRecords(rows, columns);
			const originalById = new Map(originalRows.map((row) => [row.id, row.values]));
			validateJsonRecords(definition.fileName, records, (index) => {
				const original = originalById.get(rows[index].id);
				return !original || !sameStringRecord(original, rows[index].values);
			});
			return `${JSON.stringify(records, null, 2)}\n`;
		},
		resetValues: () => {
			setRows(originalRows);
			setSelectedRowIds([]);
			setIsSelectionMode(false);
			setCurrentPage(1);
		},
	});

	const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
	React.useEffect(() => {
		setCurrentPage((page) => Math.min(page, totalPages));
	}, [totalPages]);

	const visibleRows = React.useMemo(() => {
		const startIndex = (currentPage - 1) * PAGE_SIZE;
		return rows.slice(startIndex, startIndex + PAGE_SIZE);
	}, [currentPage, rows]);

	const selectedRowIdSet = React.useMemo(() => new Set(selectedRowIds), [selectedRowIds]);
	const allVisibleSelected =
		visibleRows.length > 0 && visibleRows.every((row) => selectedRowIdSet.has(row.id));
	const selectedCount = selectedRowIds.length;

	const updateRowValue = React.useCallback(
		(rowId: string, key: string, value: string) => {
			setRows((previous) =>
				previous.map((row) =>
					row.id === rowId ? { ...row, values: { ...row.values, [key]: value } } : row,
				),
			);
			setError(null);
		},
		[setError],
	);

	const handleAddRow = React.useCallback(() => {
		setRows((previous) => {
			const templateValues: PropertyValues = {};
			for (const column of columns) {
				templateValues[column.key] = jsonColumnDefaultValue(column);
			}

			const nextRows = [...previous, { id: makeRowId(), values: templateValues }];
			setCurrentPage(Math.max(1, Math.ceil(nextRows.length / PAGE_SIZE)));
			return nextRows;
		});
		setError(null);
	}, [columns, setError]);

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

	// The page clamp above keeps the view on the current page (or the new last one).
	const deleteRows = React.useCallback(
		(rowIds: string[], exitSelectionMode = false) => {
			const rowIdSet = new Set(rowIds);
			setRows((previous) => previous.filter((row) => !rowIdSet.has(row.id)));
			setSelectedRowIds((previous) => previous.filter((rowId) => !rowIdSet.has(rowId)));
			setError(null);
			if (exitSelectionMode) {
				setIsSelectionMode(false);
			}
		},
		[setError],
	);

	return (
		<div className='space-y-6'>
			<EditorHeader
				definition={definition}
				isDirty={isDirty}
				onReload={reload}
				disabled={isLocked}
			/>
			<NetworkingDisclaimer user={user} definition={definition} />
			<div className='space-y-4'>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div className='flex flex-wrap items-center gap-2'>
						<Button type='button' variant='secondary' onClick={handleAddRow} disabled={isLocked}>
							<Plus />
							Add item
						</Button>
						<Button
							type='button'
							variant='secondary'
							onClick={
								selectedCount > 0 && isSelectionMode
									? () => deleteRows(selectedRowIds, true)
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
					<LoadingFileContents />
				) : rows.length > 0 ? (
					<div className='space-y-3'>
						<div className='flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground'>
							<span>
								Showing {Math.min(rows.length, (currentPage - 1) * PAGE_SIZE + 1)}-
								{Math.min(rows.length, currentPage * PAGE_SIZE)} of {rows.length}
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
			<EditorError message={error} />
		</div>
	);
};

export default JsonArrayConfigFileEditor;
