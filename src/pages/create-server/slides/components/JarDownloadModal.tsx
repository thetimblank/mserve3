import * as React from 'react';
import { CircleHelp, Download } from 'lucide-react';
import { toast } from 'sonner';
import {
	downloadJarRow,
	fetchJarRows,
	getJarSelectionLabel,
	getJarTabInfo,
	getJarTabs,
	isJarRowDownloadable,
	type JarTab,
	type JarVersionRow,
} from '@/lib/jar-download-service';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import JarVersionSelectorPane from './JarVersionSelectorPane';

export type DownloadedJarSelection = {
	filePath: string;
	selectionLabel: string;
	tab: JarTab;
	provider: string;
	version: string;
};

type JarDownloadModalProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDownloaded: (selection: DownloadedJarSelection) => Promise<void> | void;
};

const JarDownloadModal: React.FC<JarDownloadModalProps> = ({ open, onOpenChange, onDownloaded }) => {
	const tabs = React.useMemo(() => getJarTabs(), []);
	const [activeTab, setActiveTab] = React.useState<JarTab>('plugin');
	const [rows, setRows] = React.useState<JarVersionRow[]>([]);
	const [isLoadingRows, setIsLoadingRows] = React.useState(false);
	const [selectedRow, setSelectedRow] = React.useState<JarVersionRow | null>(null);
	const [isDownloading, setIsDownloading] = React.useState(false);

	React.useEffect(() => {
		if (!open) return;

		let cancelled = false;
		setIsLoadingRows(true);
		setSelectedRow(null);

		void fetchJarRows(activeTab)
			.then((result) => {
				if (!cancelled) {
					setRows(result);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					const message = error instanceof Error ? error.message : 'Failed to fetch jar versions.';
					toast.error(message);
					setRows([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingRows(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [activeTab, open]);

	const confirmDisabled =
		!selectedRow || !isJarRowDownloadable(selectedRow) || isDownloading || isLoadingRows;

	const onConfirm = async () => {
		if (!selectedRow || !isJarRowDownloadable(selectedRow)) return;

		setIsDownloading(true);
		try {
			const result = await downloadJarRow(selectedRow);
			await onDownloaded({
				filePath: result.path,
				selectionLabel: getJarSelectionLabel(activeTab, selectedRow.version),
				tab: activeTab,
				provider: selectedRow.provider,
				version: selectedRow.version,
			});
			onOpenChange(false);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to download jar file.';
			toast.error(message);
		} finally {
			setIsDownloading(false);
		}
	};

	const onOpenChangeInternal = (nextOpen: boolean) => {
		if (isDownloading) return;
		onOpenChange(nextOpen);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChangeInternal}>
			<DialogContent className='sm:max-w-4xl' showCloseButton={!isDownloading}>
				<DialogHeader>
					<DialogTitle>Browse and download server jars</DialogTitle>
					<DialogDescription>
						Select a provider build, confirm, and mserve will download and auto-select it as your server
						jar.
					</DialogDescription>
				</DialogHeader>

				<div className='space-y-4'>
					<div className='grid grid-cols-3 gap-2'>
						{tabs.map((tab) => {
							const isActive = tab.id === activeTab;
							return (
								<div key={tab.id} className='flex items-center gap-1'>
									<Button
										type='button'
										className='flex-1'
										variant={isActive ? 'default' : 'secondary'}
										onClick={() => setActiveTab(tab.id)}
										disabled={isDownloading}>
										{tab.label}
										<Tooltip>
											<TooltipTrigger asChild>
												<button type='button' aria-label={`About ${tab.label}`}>
													<CircleHelp className='size-4' />
												</button>
											</TooltipTrigger>
											<TooltipContent sideOffset={8}>{tab.description}</TooltipContent>
										</Tooltip>
									</Button>
								</div>
							);
						})}
					</div>

					{isDownloading ? (
						<div className='rounded-md border p-8 flex flex-col items-center justify-center gap-3 text-sm'>
							<Spinner className='size-5' />
							<div className='flex items-center gap-2'>
								<Download className='size-4' />
								<span>Downloading selected jar...</span>
							</div>
						</div>
					) : isLoadingRows ? (
						<div className='rounded-md border p-8 flex items-center justify-center gap-2 text-sm'>
							<Spinner />
							<span>Loading versions...</span>
						</div>
					) : (
						<JarVersionSelectorPane
							tab={activeTab}
							rows={rows}
							selectedRowId={selectedRow?.id ?? null}
							onSelectRow={setSelectedRow}
						/>
					)}
				</div>

				<DialogFooter>
					<Button
						type='button'
						variant='outline'
						onClick={() => onOpenChange(false)}
						disabled={isDownloading}>
						Cancel
					</Button>
					<Button type='button' onClick={onConfirm} disabled={confirmDisabled}>
						{isDownloading ? (
							<>
								<Spinner /> Downloading...
							</>
						) : (
							`Confirm ${getJarTabInfo(activeTab).label}`
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

export default JarDownloadModal;
