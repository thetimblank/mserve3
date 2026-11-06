import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { PhysicalPosition } from '@tauri-apps/api/dpi';
import { FileUp, HardDrive, Link, Link2, Link2Off, PackageSearch, Trash, Upload } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import OpenFolderButton from '@/components/open-folder-button';
import EmptyState from '@/components/empty-state';
import { FilterBar, type FilterBarFilter } from '@/components/filter-bar';
import type { ServerContentItem } from '@/data/servers';
import {
	DEFAULT_SERVER_ITEM_QUERY,
	filterServerItems,
	type ServerItemQuery,
	type ServerItemSort,
	type ServerItemSourceFilter,
	type ServerItemStatusFilter,
} from '@/lib/server-item-filters';
import clsx from 'clsx';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { m } from 'motion/react';
import { formatBytes, getErrorMessage } from '@/lib/utils';

type ItemType = 'plugin' | 'mod' | 'world' | 'datapack';

type Item = ServerContentItem;

type ServerItemListProps = {
	type: ItemType;
	icon: React.ReactNode;
	serverDirectory: string;
	title: string;
	description?: string;
	searchPlaceholder: string;
	emptyLabel: string;
	items: Item[];
	onChanged?: () => Promise<void> | void;
	disabled?: boolean;
	/** Opens the Modrinth browser. When set, a "Find on Modrinth" card sits next to the upload card. */
	onFindOnModrinth?: () => void;
	onDeleteItem?: (item: Item, type: ItemType) => Promise<void> | void;
	onUninstallItem?: (item: Item, type: ItemType) => Promise<void> | void;
	onExportItem?: (item: Item, type: ItemType) => Promise<void> | void;
};

const STATUS_OPTIONS = [
	{ value: 'active', label: 'Active' },
	{ value: 'inactive', label: 'Inactive' },
] as const satisfies readonly { value: ServerItemStatusFilter; label: string }[];

const SOURCE_OPTIONS = [
	{ value: 'modrinth', label: 'Modrinth' },
	{ value: 'manual', label: 'Added manually' },
] as const satisfies readonly { value: ServerItemSourceFilter; label: string }[];

const SORT_OPTIONS = [
	{ value: 'name', label: 'Name' },
	{ value: 'size', label: 'Size' },
	{ value: 'recent', label: 'Recently added' },
] as const satisfies readonly { value: ServerItemSort; label: string }[];

/** Shared look of the upload and "Find on Modrinth" cards, so the pair matches. */
const ACTION_CARD_CLASS =
	'flex min-h-32 cursor-pointer select-none flex-col items-center justify-center gap-1 rounded-md border-2 p-4 text-center text-sm font-bold transition-colors hover:border-accent/30 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:mb-1 [&_svg]:size-6 [&_svg]:text-muted-foreground';

const getItemPath = (serverDirectory: string, itemType: ItemType, item: Item) => {
	const base = serverDirectory.replace(/[/\\]+$/, '');
	// `/` works on every OS: the backend maps it to the native separator.
	const join = (...parts: string[]) => [base, ...parts].join('/');

	if (itemType === 'plugin') {
		return item.activated ? join('plugins', item.file) : join('inactive', 'plugins', item.file);
	}
	if (itemType === 'mod') {
		return item.activated ? join('mods', item.file) : join('inactive', 'mods', item.file);
	}
	if (itemType === 'world') {
		return item.activated ? join(item.file) : join('inactive', 'worlds', item.file);
	}
	return item.activated ? join('world', 'datapacks', item.file) : join('inactive', 'datapacks', item.file);
};

const ServerItemList: React.FC<ServerItemListProps> = ({
	type,
	serverDirectory,
	icon,
	title,
	description,
	searchPlaceholder,
	emptyLabel,
	items,
	onChanged,
	disabled,
	onFindOnModrinth,
	onDeleteItem,
	onUninstallItem,
	onExportItem,
}) => {
	const [query, setQuery] = React.useState<ServerItemQuery>(DEFAULT_SERVER_ITEM_QUERY);
	const [busyFile, setBusyFile] = React.useState<string | null>(null);
	const [isDragging, setIsDragging] = React.useState(false);
	const dropZoneRef = React.useRef<HTMLButtonElement | null>(null);
	const disabledRef = React.useRef(disabled);
	const busyFileRef = React.useRef<string | null>(busyFile);

	React.useEffect(() => {
		disabledRef.current = disabled;
	}, [disabled]);

	React.useEffect(() => {
		busyFileRef.current = busyFile;
	}, [busyFile]);

	const filtered = React.useMemo(() => filterServerItems(items, query), [items, query]);
	const updateQuery = (patch: Partial<ServerItemQuery>) => setQuery((current) => ({ ...current, ...patch }));
	const pluralLabel = title.toLowerCase();
	const isSearchOnly = query.status === null && query.source === null;

	const filters: FilterBarFilter[] = [
		{
			id: 'status',
			label: 'Status',
			type: 'single',
			options: STATUS_OPTIONS,
			value: query.status,
			onValueChange: (status: ServerItemStatusFilter | null) => updateQuery({ status }),
		},
	];
	// Worlds aren't installed from a catalog, so they have no source to filter by.
	if (type !== 'world') {
		filters.push({
			id: 'source',
			label: 'Source',
			type: 'single',
			options: SOURCE_OPTIONS,
			value: query.source,
			onValueChange: (source: ServerItemSourceFilter | null) => updateQuery({ source }),
		});
	}

	const handleToggleActive = async (item: Item) => {
		if (disabled || busyFile) return;
		setBusyFile(item.file);
		try {
			await invoke('set_server_item_active', {
				payload: {
					directory: serverDirectory,
					itemType: type,
					file: item.file,
					activate: !item.activated,
				},
			});
			await onChanged?.();
		} catch (err) {
			const message = getErrorMessage(err, 'Failed to update item.');
			toast.error(message);
		} finally {
			setBusyFile(null);
		}
	};

	const handleDelete = async (item: Item) => {
		if (disabled || busyFile) return;
		setBusyFile(item.file);
		try {
			if (onDeleteItem) {
				await onDeleteItem(item, type);
			} else {
				await invoke('delete_server_item', {
					payload: {
						directory: serverDirectory,
						itemType: type,
						file: item.file,
					},
				});
				await onChanged?.();
			}
		} catch (err) {
			const message = getErrorMessage(err, 'Failed to delete item.');
			toast.error(message);
		} finally {
			setBusyFile(null);
		}
	};

	const handleUninstall = async (item: Item) => {
		if (disabled || busyFile) return;
		setBusyFile(item.file);
		try {
			if (onUninstallItem) {
				await onUninstallItem(item, type);
			} else {
				await invoke('uninstall_server_item', {
					payload: {
						directory: serverDirectory,
						itemType: type,
						file: item.file,
					},
				});
				await onChanged?.();
			}
		} catch (err) {
			const message = getErrorMessage(err, 'Failed to uninstall item.');
			toast.error(message);
		} finally {
			setBusyFile(null);
		}
	};

	const handleExport = async (item: Item) => {
		if (disabled || busyFile) return;
		setBusyFile(item.file);

		try {
			// Hold the busy lock until the export finishes.
			await toast
				.promise(
					(async () => {
						if (onExportItem) {
							await onExportItem(item, type);
						} else {
							await invoke<{ path: string }>('export_server_world', {
								payload: {
									directory: serverDirectory,
									itemType: type,
									file: item.file,
								},
							});
						}
						return { name: item.file };
					})(),
					{
						loading: 'Loading...',
						success: (data) => `${data.name} has been exported to your downloads!`,
						error: (err) => getErrorMessage(err, 'Failed to export item.'),
					},
				)
				.unwrap();
		} catch {
			// Already surfaced by the toast.
		} finally {
			setBusyFile(null);
		}
	};

	const uploadPath = React.useCallback(
		async (sourcePath: string) => {
			await invoke('upload_server_item', {
				payload: {
					directory: serverDirectory,
					itemType: type,
					sourcePath,
				},
			});
		},
		[serverDirectory, type],
	);

	// Tauri reports the drag position in physical pixels; the rect is in CSS pixels.
	const isInDropZone = React.useCallback((position: PhysicalPosition) => {
		const element = dropZoneRef.current;
		if (!element) return false;
		const { x, y } = position.toLogical(window.devicePixelRatio || 1);
		const rect = element.getBoundingClientRect();
		return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
	}, []);

	const handleDroppedPaths = React.useCallback(
		async (paths: string[]) => {
			if (disabledRef.current || busyFileRef.current) return;

			const droppedPaths = paths.filter(
				(path): path is string => typeof path === 'string' && path.length > 0,
			);

			if (droppedPaths.length === 0) {
				toast.error('Could not read dropped file paths. Click the upload box to browse instead.');
				return;
			}

			busyFileRef.current = '__upload__';
			setBusyFile('__upload__');
			try {
				for (const path of droppedPaths) {
					await uploadPath(path);
				}
				await onChanged?.();
			} catch (err) {
				const message = getErrorMessage(err, 'Failed to upload dropped item.');
				toast.error(message);
			} finally {
				busyFileRef.current = null;
				setBusyFile(null);
			}
		},
		[onChanged, uploadPath],
	);

	React.useEffect(() => {
		let unlisten: (() => void) | undefined;
		let disposed = false;

		void getCurrentWebview()
			.onDragDropEvent((event) => {
				const payload = event.payload;

				if (payload.type === 'over') {
					setIsDragging(isInDropZone(payload.position));
					return;
				}

				if (payload.type === 'drop') {
					setIsDragging(false);
					if (!isInDropZone(payload.position)) {
						return;
					}
					void handleDroppedPaths(payload.paths);
					return;
				}

				setIsDragging(false);
			})
			.then((unlistenFn) => {
				if (disposed) {
					unlistenFn();
					return;
				}
				unlisten = unlistenFn;
			})
			.catch(() => {
				setIsDragging(false);
			});

		return () => {
			disposed = true;
			setIsDragging(false);
			unlisten?.();
		};
	}, [handleDroppedPaths, isInDropZone]);

	const handleAddItem = async () => {
		if (disabled || busyFile) return;
		setBusyFile('__upload__');
		try {
			const selected = await openDialog({
				multiple: true,
				directory: false,
				title:
					type === 'plugin'
						? 'Add plugin(s)'
						: type === 'mod'
							? 'Add mod(s)'
							: type === 'world'
								? 'Add world zip/folder'
								: 'Add datapack(s)',
			});

			const paths = (Array.isArray(selected) ? selected : selected ? [selected] : []).filter(
				(path): path is string => typeof path === 'string',
			);

			for (const path of paths) {
				await uploadPath(path);
			}
			if (paths.length > 0) {
				await onChanged?.();
			}
		} catch (err) {
			const message = getErrorMessage(err, 'Failed to upload item.');
			toast.error(message);
		} finally {
			setBusyFile(null);
		}
	};

	return (
		<div className='flex flex-col gap-3 min-h-100'>
			<div className='flex flex-col gap-1 min-h-10'>
				<div className='flex items-center gap-2'>
					{icon}
					<p className='text-2xl font-bold'>{title}</p>
				</div>
				{description && <p className='text-muted-foreground'>{description}</p>}
			</div>

			<div className={clsx('grid gap-3', onFindOnModrinth && 'sm:grid-cols-2')}>
				<button
					type='button'
					ref={dropZoneRef}
					onClick={handleAddItem}
					disabled={disabled || busyFile === '__upload__'}
					className={clsx(
						ACTION_CARD_CLASS,
						isDragging ? 'border-accent border-solid bg-accent/30' : 'border-border border-dashed',
					)}>
					<FileUp />
					{isDragging ? (
						<span className='block'>Drop to upload {pluralLabel}!</span>
					) : (
						<>
							<span className='block'>
								Drop files <span className='mx-2 text-muted-foreground'>OR</span> Click Here
							</span>
							<span className='block text-muted-foreground'>to upload {pluralLabel}.</span>
						</>
					)}
				</button>
				{onFindOnModrinth && (
					<button
						type='button'
						onClick={onFindOnModrinth}
						disabled={disabled}
						className={clsx(ACTION_CARD_CLASS, 'border-border')}>
						<PackageSearch />
						<span className='block'>Find on Modrinth</span>
						<span className='block text-muted-foreground'>Search for {pluralLabel} and install them here.</span>
					</button>
				)}
			</div>

			{items.length > 0 && (
				<FilterBar
					className='mt-2'
					search={{
						value: query.search,
						onValueChange: (search) => updateQuery({ search }),
						placeholder: searchPlaceholder,
					}}
					filters={filters}
					sort={{
						options: SORT_OPTIONS,
						value: query.sort,
						onValueChange: (sort: ServerItemSort) => updateQuery({ sort }),
					}}
				/>
			)}

			<div className='flex flex-col gap-3'>
				{filtered.length > 0 &&
					filtered.map((item, i) => (
						<m.div
							key={item.file}
							initial={{ height: 0, opacity: 0 }}
							animate={{ height: 'auto', opacity: 1 }}
							transition={{ type: 'spring', duration: 0.3, bounce: 0, delay: i * 0.05 }}>
							<Card>
								<CardHeader className='border-b-2 border-b-border'>
									<CardTitle>{item.name ?? item.file}</CardTitle>
									<CardDescription className='flex gap-6'>
										{item.activated ? (
											<div className='flex items-center font-bold lg:text-lg gap-2 text-green-500'>
												<Link2 className='size-5' />
												Active
											</div>
										) : (
											<div className='flex items-center font-bold lg:text-lg gap-2 text-red-400'>
												<Link2Off className='size-5' />
												Inactive
											</div>
										)}

										{typeof item.size === 'number' && (
											<Tooltip>
												<TooltipTrigger>
													<div className='flex items-center lg:text-lg gap-2'>
														<HardDrive className='size-4' />
														{formatBytes(item.size)}
													</div>
												</TooltipTrigger>
												<TooltipContent>
													<p className='font-bold'>Size on disk</p>
												</TooltipContent>
											</Tooltip>
										)}
										{item.url && (
											<div className='flex items-center lg:text-lg gap-2'>
												<Link className='size-4' />
												{item.url}
											</div>
										)}
									</CardDescription>
								</CardHeader>
								<CardContent className='flex gap-2'>
									<OpenFolderButton
										targetPath={getItemPath(serverDirectory, type, item)}
										disabled={busyFile === item.file}
									/>
									{type === 'world' && (
										<Button
											variant='secondary'
											disabled={disabled || busyFile === item.file}
											onClick={() => handleExport(item)}>
											<Upload />
											Export
										</Button>
									)}
									{item.activated ? (
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button variant='secondary' disabled={disabled || busyFile === item.file}>
													<Link2Off />
													Deactivate
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Are you sure?</AlertDialogTitle>
													<AlertDialogDescription>
														Deactivating this {type} will temporarily move it to another
														directory so it is not loaded when the server runs until it is
														reactivated. <br /> Deactivating this may cause unwanted behavior.
														{(type === 'plugin' || type === 'mod') &&
															` ${type === 'plugin' ? 'Plugins' : 'Mods'} that rely on this ${type} may break.`}
														{type === 'datapack' &&
															' Datapacks may regenerate new or features might stop working.'}
														{type === 'world' &&
															' Worlds may regnerate new or other unwanted effects may occur.'}
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Cancel</AlertDialogCancel>
													<AlertDialogAction
														className='capitalize'
														onClick={() => handleToggleActive(item)}>
														Deactivate {type}
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									) : (
										<Button
											onClick={() => handleToggleActive(item)}
											variant='secondary'
											disabled={disabled || busyFile === item.file}>
											<Link2 />
											Activate
										</Button>
									)}
									{(type === 'plugin' || type === 'mod') && (
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button
													variant='destructive-secondary'
													disabled={disabled || busyFile === item.file}>
													<Trash />
													Uninstall
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Are you sure?</AlertDialogTitle>
													<AlertDialogDescription>
														This will move the {type} to the recycling bin.
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Cancel</AlertDialogCancel>
													<AlertDialogAction
														className='capitalize'
														variant='destructive-secondary'
														onClick={() => handleUninstall(item)}>
														Uninstall {type}
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									)}
									{(type === 'world' || type === 'datapack') && (
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button
													variant='destructive-secondary'
													disabled={disabled || busyFile === item.file}>
													<Trash />
													Delete
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Are you sure?</AlertDialogTitle>
													<AlertDialogDescription>
														This will move the {type} to the recycling bin.
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Cancel</AlertDialogCancel>
													<AlertDialogAction
														variant='destructive-secondary'
														className='capitalize'
														onClick={() => handleDelete(item)}>
														Delete {type}
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									)}
								</CardContent>
							</Card>
						</m.div>
					))}
			</div>

			{items.length === 0 ? (
				<EmptyState
					icon={icon}
					title={emptyLabel}
					description={
						disabled
							? undefined
							: onFindOnModrinth
								? `Find ${pluralLabel} on Modrinth, or drop files into the upload box above.`
								: 'Drop files into the upload box above, or click it to pick them.'
					}
					action={
						onFindOnModrinth
							? { label: 'Find on Modrinth', icon: PackageSearch, onClick: onFindOnModrinth, disabled }
							: undefined
					}
				/>
			) : (
				filtered.length === 0 && (
					<EmptyState
						variant='no-results'
						title='No matches'
						description={
							isSearchOnly
								? `Nothing here matches "${query.search.trim()}".`
								: `No ${pluralLabel} match these filters.`
						}
						clearSearchLabel={isSearchOnly ? 'Clear search' : 'Clear filters'}
						onClearSearch={() => setQuery((current) => ({ ...DEFAULT_SERVER_ITEM_QUERY, sort: current.sort }))}
					/>
				)
			)}
		</div>
	);
};

export default ServerItemList;
