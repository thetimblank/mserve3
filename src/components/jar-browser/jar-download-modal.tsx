import * as React from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import {
	downloadAndResolveJarRow,
	getJarSelectionLabel,
	getJarTabInfo,
	type JarTab,
	type JarVersionRow,
} from '@/lib/jar-download-service';
import type { Provider } from '@/lib/mserve-schema';
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
import JarBrowser from './jar-browser';
import { getErrorMessage } from '@/lib/utils';

export type DownloadedJarSelection = {
	filePath: string;
	selectionLabel: string;
	tab: JarTab;
	provider: Provider;
};

type JarDownloadModalProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDownloaded: (selection: DownloadedJarSelection) => Promise<void> | void;
};

const JarDownloadModal: React.FC<JarDownloadModalProps> = ({ open, onOpenChange, onDownloaded }) => {
	const [activeTab, setActiveTab] = React.useState<JarTab>('plugin');
	const [isLoadingRows, setIsLoadingRows] = React.useState(false);
	const [selectedRow, setSelectedRow] = React.useState<JarVersionRow | null>(null);
	const [isDownloading, setIsDownloading] = React.useState(false);

	const confirmDisabled = !selectedRow || isDownloading || isLoadingRows;

	const onConfirm = async () => {
		if (!selectedRow) return;

		setIsDownloading(true);
		try {
			const { result, provider } = await downloadAndResolveJarRow(selectedRow);
			await onDownloaded({
				filePath: result.path,
				selectionLabel: getJarSelectionLabel(activeTab, selectedRow.version),
				tab: activeTab,
				provider,
			});
			onOpenChange(false);
		} catch (error) {
			const message = getErrorMessage(error, 'Failed to download jar file.');
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
			<DialogContent
				className='flex max-h-[85vh] flex-col sm:max-w-4xl'
				showCloseButton={!isDownloading}>
				<DialogHeader>
					<DialogTitle>Browse and download server jars</DialogTitle>
					<DialogDescription>
						Select a provider build, confirm, and mserve will download and auto-select it as your server
						jar.
					</DialogDescription>
				</DialogHeader>

				<div className='min-h-0 flex-1 overflow-y-auto'>
					{isDownloading ? (
						<div className='rounded-md border-2 p-8 flex flex-col items-center justify-center gap-3 text-sm'>
							<Spinner className='size-5' />
							<div className='flex items-center gap-2'>
								<Download className='size-4' />
								<span>Downloading selected jar...</span>
							</div>
						</div>
					) : (
						open && (
							<JarBrowser
								selectedRowId={selectedRow?.id ?? null}
								onSelectRow={setSelectedRow}
								onTabChange={setActiveTab}
								onLoadingChange={setIsLoadingRows}
								onLoadError={(message) => toast.error(message)}
							/>
						)
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
