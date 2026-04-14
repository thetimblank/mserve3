import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
	Archive,
	ArrowUpRightFromSquare,
	HardDrive,
	Link,
	Link2,
	Link2Off,
	Trash,
	Upload,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import OpenFolderButton from '@/components/open-folder-button';
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

type ItemType = 'plugin' | 'world' | 'datapack';

type Item = {
	name?: string;
	file: string;
	activated: boolean;
	size?: number;
	url?: string;
};

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
	ctaLabel?: string;
	ctaUrl?: string;
	onDeleteItem?: (item: Item, type: ItemType) => Promise<void> | void;
	onUninstallItem?: (item: Item, type: ItemType) => Promise<void> | void;
	onExportItem?: (item: Item, type: ItemType) => Promise<void> | void;
};

const formatBytes = (bytes?: number) => {
	if (bytes === undefined) return null;
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return `${value.toFixed(2)} ${units[unitIndex]}`;
};

const getItemPath = (serverDirectory: string, itemType: ItemType, item: Item) => {
	const base = serverDirectory.replace(/[/\\]+$/, '');
	const join = (...parts: string[]) => [base, ...parts].join('\\');

	if (itemType === 'plugin') {
		return item.activated ? join('plugins', item.file) : join('inactive', 'plugins', item.file);
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
	ctaLabel,
	ctaUrl,
	onDeleteItem,
	onUninstallItem,
	onExportItem,
}) => {
	const [search, setSearch] = React.useState('');
	const [busyFile, setBusyFile] = React.useState<string | null>(null);
	const [isDragging, setIsDragging] = React.useState(false);
	const dropZoneRef = React.useRef<HTMLDivElement | null>(null);
	const disabledRef = React.useRef(disabled);
	const busyFileRef = React.useRef<string | null>(busyFile);

	React.useEffect(() => {
		disabledRef.current = disabled;
	}, [disabled]);

	React.useEffect(() => {
		busyFileRef.current = busyFile;
	}, [busyFile]);

	const filtered = React.useMemo(() => {
		const term = search.trim().toLowerCase();
		if (!term) return items;
		return items.filter((item) => {
			const name = (item.name ?? '').toLowerCase();
			const file = item.file.toLowerCase();
			return name.includes(term) || file.includes(term);
		});
	}, [items, search]);

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
			const message = err instanceof Error ? err.message : 'Failed to update item.';
			window.alert(message);
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
			const message = err instanceof Error ? err.message : 'Failed to delete item.';
			window.alert(message);
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
			const message = err instanceof Error ? err.message : 'Failed to uninstall item.';
			window.alert(message);
		} finally {
			setBusyFile(null);
		}
	};

	const handleExport = async (item: Item) => {
		if (disabled || busyFile) return;
		setBusyFile(item.file);

		try {
			toast.promise(
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
					error: (err) => (err instanceof Error ? err.message : 'Failed to export item.'),
				},
			);
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

	const isInDropZone = React.useCallback((x: number, y: number) => {
		const element = dropZoneRef.current;
		if (!element) return false;
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
				window.alert('Could not read dropped file paths. Use Add to browse instead.');
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
				const message = err instanceof Error ? err.message : 'Failed to upload dropped item.';
				window.alert(message);
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
					setIsDragging(isInDropZone(payload.position.x, payload.position.y));
					return;
				}

				if (payload.type === 'drop') {
					setIsDragging(false);
					if (!isInDropZone(payload.position.x, payload.position.y)) {
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
			const message = err instanceof Error ? err.message : 'Failed to upload item.';
			window.alert(message);
		} finally {
			setBusyFile(null);
		}
	};

	return (
		<div className='flex flex-col gap-1 min-h-100'>
			<div className='flex items-center justify-between gap-5 min-h-10'>
				<div className='flex-col gap-1'>
					<div className='flex items-center gap-2'>
						{icon}
						<p className='text-2xl font-bold'>{title}</p>
					</div>
					{description && <p className='text-muted-foreground'>{description}</p>}
				</div>
				{ctaLabel && ctaUrl && (
					<Button onClick={() => openUrl(ctaUrl)} variant='link'>
						{ctaLabel}
						{type === 'world' ? <Archive /> : <ArrowUpRightFromSquare />}
					</Button>
				)}
			</div>
			<Input
				type='search'
				placeholder={searchPlaceholder}
				value={search}
				onChange={(e) => setSearch(e.target.value)}
			/>
			<div className='flex flex-col gap-4 mt-4'>
				{filtered.length > 0 &&
					filtered.map((item, i) => (
						<m.div
							key={item.file}
							initial={{ scale: 0.75, y: 10, opacity: 0 }}
							animate={{ scale: 1, y: 0, opacity: 1 }}
							transition={{ type: 'spring', duration: 0.3, bounce: 0, delay: i * 0.05 }}>
							<Card>
								<CardHeader className='border-b border-b-border'>
									<CardTitle>{item.name ?? item.file}</CardTitle>
									<CardDescription className='flex gap-6'>
										{item.activated ? (
											<div className='flex items-center font-bold lg:text-lg gap-1 text-green-500'>
												<Link2 className='size-5' />
												Active
											</div>
										) : (
											<div className='flex items-center font-bold lg:text-lg gap-1 text-red-400'>
												<Link2Off className='size-5' />
												Inactive
											</div>
										)}

										{typeof item.size === 'number' && (
											<Tooltip>
												<TooltipTrigger>
													<div className='flex items-center lg:text-lg gap-1'>
														<HardDrive className='size-4' />
														{formatBytes(item.size)}
													</div>
												</TooltipTrigger>
												<TooltipContent>
													<p className='font-bold'>World Folder Size</p>
												</TooltipContent>
											</Tooltip>
										)}
										{item.url && (
											<div className='flex items-center lg:text-lg gap-1'>
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
														{type === 'plugin' &&
															' Plugins that rely on this plugin may break.'}
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
									{type === 'plugin' && (
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
			<div
				ref={dropZoneRef}
				onClick={handleAddItem}
				className={clsx(
					'flex flex-col gap-2 mt-3 items-center justify-center rounded-md border-2 hover:bg-accent/30 transition-colors min-h-32 p-4 cursor-pointer select-none font-bold text-sm',
					isDragging
						? 'border-accent bg-accent/30 border-solid'
						: 'border-accent/75 bg-accent/20 border-dashed',
					(disabled || busyFile === '__upload__') && 'opacity-50 pointer-events-none',
				)}>
				{isDragging ? (
					<p>Drop to upload {title.slice(0, title.length - 1).toLowerCase()}! </p>
				) : (
					<>
						<p>
							Drop files <span className='mx-2 text-muted-foreground'>OR</span> Click Here
						</p>
						<p className='text-muted-foreground'>to upload {title.toLowerCase()}.</p>
					</>
				)}
			</div>
			{filtered.length === 0 && <p className='text-center text-muted-foreground my-10'>{emptyLabel}</p>}
		</div>
	);
};

export default ServerItemList;
