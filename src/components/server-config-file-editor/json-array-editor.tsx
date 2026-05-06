import React from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUser } from '@/data/user';

import { getManagedConfigToastId, readManagedConfigFile, writeManagedConfigFile } from './file-operations';
import {
	areJsonRowsEqual,
	createJsonRows,
	inferJsonColumns,
	jsonColumnDefaultValue,
	jsonRowsToRecords,
	parseJsonRecordList,
} from './json-config';
import { EditorError, EditorHeader, LoadingFileContents, NetworkingDisclaimer } from './layout';
import type { JsonColumn, JsonRow, PropertyValues, ServerConfigFileEditorProps } from './types';
import { useUnsavedChangesToast } from './use-unsaved-changes-toast';
import { makeRowId, toErrorMessage } from './utils';

const PAGE_SIZE = 10;

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

	const isLocked = Boolean(disabled || isLoading || isSaving);
	const isDirty = React.useMemo(() => !areJsonRowsEqual(rows, originalRows), [originalRows, rows]);
	const toastId = React.useMemo(
		() => getManagedConfigToastId(serverDirectory, definition.fileName),
		[definition.fileName, serverDirectory],
	);

	const applyContent = React.useCallback(
		(content: string) => {
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
		[definition.fileName],
	);

	const loadContent = React.useCallback(async () => {
		if (!serverDirectory.trim()) return;

		setIsLoading(true);
		setError(null);
		try {
			const result = await readManagedConfigFile(serverDirectory, definition.fileName);
			applyContent(result.content);
		} catch (err) {
			setError(toErrorMessage(err, `Could not load ${definition.fileName}.`));
		} finally {
			setIsLoading(false);
		}
	}, [applyContent, definition.fileName, serverDirectory]);

	React.useEffect(() => {
		void loadContent();
	}, [loadContent]);

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
			setCurrentPage(Math.max(1, Math.ceil(nextRows.length / PAGE_SIZE)));
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

	const deleteRows = React.useCallback((rowIds: string[], exitSelectionMode = false) => {
		const rowIdSet = new Set(rowIds);
		setRows((previous) => previous.filter((row) => !rowIdSet.has(row.id)));
		setSelectedRowIds((previous) => previous.filter((rowId) => !rowIdSet.has(rowId)));
		setCurrentPage(1);
		setError(null);
		if (exitSelectionMode) {
			setIsSelectionMode(false);
		}
	}, []);

	const handleSave = React.useCallback(async () => {
		if (isLocked) return;

		setError(null);
		setIsSaving(true);
		try {
			const normalizedRecords = jsonRowsToRecords(rows, columns);
			const normalizedContent = `${JSON.stringify(normalizedRecords, null, 2)}\n`;
			const result = await writeManagedConfigFile(
				serverDirectory,
				definition.fileName,
				normalizedContent,
			);

			applyContent(result.content);
			toast.success(`${definition.title} saved.`);
			await onSaved?.();
		} catch (err) {
			setError(toErrorMessage(err, `Could not save ${definition.fileName}.`));
		} finally {
			setIsSaving(false);
		}
	}, [applyContent, columns, definition.fileName, definition.title, isLocked, onSaved, rows, serverDirectory]);

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
			<EditorHeader
				definition={definition}
				isDirty={isDirty}
				onReload={handleReload}
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
