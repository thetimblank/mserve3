import * as React from 'react';
import { CircleHelp } from 'lucide-react';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { fetchJarRows, getJarTabs, type JarTab, type JarVersionRow } from '@/lib/jar-download-service';
import { getErrorMessage } from '@/lib/utils';
import JarVersionSelectorPane from './jar-version-selector-pane';

type JarBrowserProps = {
	selectedRowId: string | null;
	/** Must keep one identity: the pane clears the selection through it. */
	onSelectRow: (row: JarVersionRow | null) => void;
	onTabChange?: (tab: JarTab) => void;
	onLoadingChange?: (isLoading: boolean) => void;
	onLoadError: (message: string) => void;
	disabled?: boolean;
	installedMajors?: number[];
	isCheckingJavaCompatibility?: boolean;
};

/**
 * Server-jar picker: provider tabs over a filterable version list, loaded from
 * the backend. Shared by the create wizard and the jar-swap dialog. The list
 * stays mounted while rows reload, so its filters survive (turning on unstable
 * builds triggers a reload).
 */
const JarBrowser: React.FC<JarBrowserProps> = ({
	selectedRowId,
	onSelectRow,
	onTabChange,
	onLoadingChange,
	onLoadError,
	disabled = false,
	installedMajors,
	isCheckingJavaCompatibility,
}) => {
	const tabOptions = React.useMemo<SegmentedControlOption<JarTab>[]>(
		() =>
			getJarTabs().map((tab) => ({
				value: tab.id,
				label: (
					<>
						{tab.label}
						<CircleHelp aria-hidden className='size-4 opacity-60' />
					</>
				),
				ariaLabel: tab.label,
				tooltip: tab.description,
			})),
		[],
	);
	const [activeTab, setActiveTab] = React.useState<JarTab>('plugin');
	const [includeUnstable, setIncludeUnstable] = React.useState(false);
	const [rows, setRows] = React.useState<JarVersionRow[]>([]);
	const [isLoading, setIsLoading] = React.useState(false);

	const callbacksRef = React.useRef({ onSelectRow, onTabChange, onLoadingChange, onLoadError });
	callbacksRef.current = { onSelectRow, onTabChange, onLoadingChange, onLoadError };

	// Reported from here (not the click) so the parent also learns the tab a
	// fresh mount starts on.
	React.useEffect(() => {
		callbacksRef.current.onTabChange?.(activeTab);
	}, [activeTab]);

	React.useEffect(() => {
		let cancelled = false;
		setIsLoading(true);
		callbacksRef.current.onLoadingChange?.(true);
		callbacksRef.current.onSelectRow(null);

		void fetchJarRows(activeTab, includeUnstable)
			.then((result) => {
				if (!cancelled) setRows(result);
			})
			.catch((error) => {
				if (cancelled) return;
				callbacksRef.current.onLoadError(getErrorMessage(error, 'Failed to fetch jar versions.'));
				setRows([]);
			})
			.finally(() => {
				if (cancelled) return;
				setIsLoading(false);
				callbacksRef.current.onLoadingChange?.(false);
			});

		return () => {
			cancelled = true;
		};
	}, [activeTab, includeUnstable]);

	const selectTab = (tab: JarTab) => {
		setActiveTab(tab);
		setIncludeUnstable(false);
	};

	return (
		<>
			<SegmentedControl
				fullWidth
				aria-label='Server type'
				className='mb-3'
				value={activeTab}
				onValueChange={selectTab}
				options={tabOptions}
				disabled={disabled}
			/>

			<JarVersionSelectorPane
				tab={activeTab}
				rows={rows}
				isLoading={isLoading}
				installedMajors={installedMajors}
				isCheckingJavaCompatibility={isCheckingJavaCompatibility}
				selectedRowId={selectedRowId}
				onSelectRow={onSelectRow}
				onRequestUnstableVersions={() => setIncludeUnstable(true)}
			/>
		</>
	);
};

export default JarBrowser;
