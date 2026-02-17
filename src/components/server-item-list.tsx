import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Archive, ArrowUpRightFromSquare, Check, HardDrive, LinkIcon, X } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import OpenFolderButton from '@/components/open-folder-button';

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
	description: string;
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
			if (onExportItem) {
				await onExportItem(item, type);
			} else {
				const result = await invoke<{ path: string }>('export_server_world', {
					payload: {
						directory: serverDirectory,
						itemType: type,
						file: item.file,
					},
				});
				window.alert(`World exported to: ${result.path}`);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to export item.';
			window.alert(message);
		} finally {
			setBusyFile(null);
		}
	};

	return (
		<div className='flex flex-col gap-1 min-h-100'>
			<div className='flex justify-between gap-5'>
				<div className='flex-col gap-1'>
					<div className='flex items-center gap-2'>
						{icon}
						<p className='text-3xl font-bold'>{title}</p>
					</div>
					<p className='text-muted-foreground'>{description}</p>
				</div>
				{ctaLabel && ctaUrl && (
					<Button onClick={() => openUrl(ctaUrl)}>
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
				{filtered.length <= 0 ? (
					<p className='text-xl text-muted-foreground'>{emptyLabel}</p>
				) : (
					filtered.map((item) => (
						<Card key={item.file}>
							<CardHeader className='border-b border-b-border'>
								<CardTitle>{item.name ?? item.file}</CardTitle>
								<CardDescription className='flex gap-6'>
									{item.activated ? (
										<div className='flex items-center font-bold lg:text-lg gap-1 text-green-500'>
											<Check className='size-5' />
											Active
										</div>
									) : (
										<div className='flex items-center font-bold lg:text-lg gap-1 text-red-400'>
											<X className='size-5' />
											Inactive
										</div>
									)}
									{typeof item.size === 'number' && (
										<div className='flex items-center lg:text-lg gap-1'>
											<HardDrive className='size-4' />
											{formatBytes(item.size)}
										</div>
									)}
									{item.url && (
										<div className='flex items-center lg:text-lg gap-1'>
											<LinkIcon className='size-4' />
											{item.url}
										</div>
									)}
								</CardDescription>
							</CardHeader>
							<CardContent className='flex gap-2'>
								{type === 'world' && (
									<Button
										variant='secondary'
										disabled={disabled || busyFile === item.file}
										onClick={() => handleExport(item)}>
										Export
									</Button>
								)}
								<OpenFolderButton
									targetPath={getItemPath(serverDirectory, type, item)}
									disabled={busyFile === item.file}
								/>
								{type === 'plugin' && (
									<Button
										variant='destructive'
										disabled={disabled || busyFile === item.file}
										onClick={() => handleUninstall(item)}>
										Uninstall
									</Button>
								)}
								{(type === 'world' || type === 'datapack') && (
									<Button
										variant='destructive'
										disabled={disabled || busyFile === item.file}
										onClick={() => handleDelete(item)}>
										Delete
									</Button>
								)}
								<Button
									variant='secondary'
									disabled={disabled || busyFile === item.file}
									onClick={() => handleToggleActive(item)}>
									{item.activated ? 'Deactivate' : 'Activate'}
								</Button>
							</CardContent>
						</Card>
					))
				)}
			</div>
		</div>
	);
};

export default ServerItemList;
