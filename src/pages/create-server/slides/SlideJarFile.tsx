import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { CircleHelp, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUser } from '@/data/user';
import { chooseBestInstalledJava, resolveJavaRequirement } from '@/lib/java-compatibility';
import {
	downloadJarRow,
	fetchJarRows,
	getJarTabs,
	isJarRowDownloadable,
	type DownloadServerJarProgressEvent,
	type JarTab,
	type JarVersionRow,
} from '@/lib/jar-download-service';
import { detectJavaRuntimes, type JavaRuntimeInfo } from '@/lib/java-runtime-service';
import { inferProviderFromJarPath, inferVersionFromJarPath } from '@/lib/server-provider-capabilities';
import { isServerProvider, providerOptions } from '@/lib/server-provider';
import { useCreateServer, type PathValidationResult } from '../CreateServerContext';
import JarVersionSelectorPane from './components/JarVersionSelectorPane';
import SlideShell from './SlideShell';

const normalizePathLike = (value: string) => value.trim().replace(/\\/g, '/').toLowerCase();

const SlideJarFile: React.FC = () => {
	const { user } = useUser();
	const { form, updateField, nextSlide, setError, clearError } = useCreateServer();
	const tabs = React.useMemo(() => getJarTabs(), []);
	const [activeTab, setActiveTab] = React.useState<JarTab>('plugin');
	const [rows, setRows] = React.useState<JarVersionRow[]>([]);
	const [isLoadingRows, setIsLoadingRows] = React.useState(false);
	const [selectedRow, setSelectedRow] = React.useState<JarVersionRow | null>(null);
	const [isDownloading, setIsDownloading] = React.useState(false);
	const [downloadProgress, setDownloadProgress] = React.useState(0);
	const [runtimes, setRuntimes] = React.useState<JavaRuntimeInfo[]>([]);
	const [isCheckingJavaCompatibility, setIsCheckingJavaCompatibility] = React.useState(true);

	const inferredProvider = React.useMemo(() => inferProviderFromJarPath(form.file), [form.file]);
	const inferredVersion = React.useMemo(() => inferVersionFromJarPath(form.file), [form.file]);
	const installedMajors = React.useMemo(
		() => Array.from(new Set(runtimes.map((runtime) => runtime.majorVersion))).sort((a, b) => b - a),
		[runtimes],
	);
	const runtimeByMajor = React.useMemo(() => {
		const map = new Map<number, JavaRuntimeInfo>();
		for (const runtime of runtimes) {
			if (!map.has(runtime.majorVersion)) {
				map.set(runtime.majorVersion, runtime);
			}
		}
		return map;
	}, [runtimes]);

	const isAdvancedMode = user.advanced_mode;

	React.useEffect(() => {
		let cancelled = false;
		setIsCheckingJavaCompatibility(true);
		void detectJavaRuntimes()
			.then((result) => {
				if (cancelled) return;
				setRuntimes(result.runtimes);
			})
			.catch(() => {
				if (cancelled) return;
				setRuntimes([]);
			})
			.finally(() => {
				if (cancelled) return;
				setIsCheckingJavaCompatibility(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	React.useEffect(() => {
		let cancelled = false;
		setIsLoadingRows(true);
		setSelectedRow(null);

		void fetchJarRows(activeTab)
			.then((result) => {
				if (cancelled) return;
				setRows(result);
			})
			.catch((error) => {
				if (cancelled) return;
				const message = error instanceof Error ? error.message : 'Failed to fetch jar versions.';
				setError(message);
				setRows([]);
			})
			.finally(() => {
				if (cancelled) return;
				setIsLoadingRows(false);
			});

		return () => {
			cancelled = true;
		};
	}, [activeTab, setError]);

	const resolveDefaultJavaMajor = React.useCallback(() => {
		const defaultJava = user.java_installation_default.trim();
		if (!defaultJava) return null;

		if (defaultJava.toLowerCase() === 'java') {
			return installedMajors[0] ?? null;
		}

		const normalizedDefault = normalizePathLike(defaultJava);
		const matchedRuntime = runtimes.find(
			(runtime) => normalizePathLike(runtime.executablePath) === normalizedDefault,
		);
		if (matchedRuntime) {
			return matchedRuntime.majorVersion;
		}

		return installedMajors[0] ?? null;
	}, [installedMajors, runtimes, user.java_installation_default]);

	const maybeApplyJavaOverride = React.useCallback(
		(providerId: string, version: string) => {
			const requirement = resolveJavaRequirement(providerId, version);
			const defaultMajor = resolveDefaultJavaMajor();
			const defaultCompatible = defaultMajor != null && defaultMajor >= requirement.minimumMajor;

			if (defaultCompatible) {
				updateField('java_installation', '');
				return;
			}

			const bestInstalledMajor = chooseBestInstalledJava(installedMajors, requirement);
			if (!bestInstalledMajor) return;
			const runtime = runtimeByMajor.get(bestInstalledMajor);
			if (!runtime) return;
			updateField('java_installation', runtime.executablePath);
		},
		[installedMajors, resolveDefaultJavaMajor, runtimeByMajor, updateField],
	);

	const applyInferredMetadata = React.useCallback(
		(filePath: string) => {
			const provider = inferProviderFromJarPath(filePath);
			const version = inferVersionFromJarPath(filePath);
			if (provider) {
				updateField('provider', provider);
				if (version) {
					maybeApplyJavaOverride(provider, version);
				}
			}
			updateField('version', version ?? '');
		},
		[maybeApplyJavaOverride, updateField],
	);

	const onPickServerFile = async () => {
		try {
			const selected = await openDialog({
				directory: false,
				multiple: false,
				filters: [
					{
						extensions: ['jar'],
						name: 'Jar Files',
					},
				],
				title: 'Choose server jar file',
			});

			if (typeof selected === 'string') {
				updateField('file', selected);
				applyInferredMetadata(selected);
				clearError();
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Could not open file picker.';
			setError(message);
		}
	};

	const onContinue = async () => {
		if (isDownloading) {
			return;
		}

		try {
			if (selectedRow && isJarRowDownloadable(selectedRow)) {
				const downloadId =
					typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
						? crypto.randomUUID()
						: `${Date.now()}-${Math.random().toString(16).slice(2)}`;

				let unlisten: UnlistenFn | null = null;
				setDownloadProgress(0);
				setIsDownloading(true);

				try {
					unlisten = await listen<DownloadServerJarProgressEvent>(
						'server-jar-download-progress',
						(event) => {
							if (event.payload.downloadId !== downloadId) {
								return;
							}

							const nextProgress = Number.isFinite(event.payload.progress)
								? Math.max(0, Math.min(1, event.payload.progress))
								: 0;
							setDownloadProgress(nextProgress);
						},
					);

					const result = await downloadJarRow(selectedRow, { downloadId });
					const fileValidation = await invoke<PathValidationResult>('validate_path', {
						path: result.path,
					});

					if (!fileValidation.exists || !fileValidation.isFile) {
						throw new Error('Downloaded jar could not be validated. Please try again.');
					}

					setDownloadProgress(1);
					updateField('file', result.path);
					updateField('provider', selectedRow.providerId);
					updateField('version', selectedRow.version);
					maybeApplyJavaOverride(selectedRow.providerId, selectedRow.version);
					clearError();
					nextSlide();
					return;
				} finally {
					if (unlisten) {
						unlisten();
					}
					setIsDownloading(false);
					setDownloadProgress(0);
				}
			}

			const file = form.file.trim();
			if (!file) {
				setError('Please choose a server jar file.');
				return;
			}

			if (!file.toLowerCase().endsWith('.jar')) {
				setError('Server file must be a .jar file.');
				return;
			}

			const fileValidation = await invoke<PathValidationResult>('validate_path', { path: file });
			if (!fileValidation.exists || !fileValidation.isFile) {
				setError('Please choose a valid server jar file.');
				return;
			}

			if (inferredProvider && inferredProvider !== form.provider) {
				updateField('provider', inferredProvider);
			}

			if (!form.version && inferredVersion) {
				updateField('version', inferredVersion);
			}

			clearError();
			nextSlide();
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to validate jar file path.';
			setError(message);
		}
	};

	return (
		<SlideShell
			fullWidth
			title='Choose the server jar file'
			description='Browse and download a supported server jar. Advanced mode enables manual file and provider selection.'
			actions={
				<Button
					type='button'
					onClick={onContinue}
					disabled={isDownloading || isLoadingRows}
					className='relative overflow-hidden'>
					{isDownloading ? (
						<>
							<Spinner /> Downloading & Continuing...
						</>
					) : (
						'Download & Continue'
					)}
					{isDownloading && (
						<span className='pointer-events-none absolute inset-x-0 bottom-0 h-1 w-full bg-primary-foreground/20'>
							<span
								className='block h-full bg-primary-foreground transition-[width] duration-150 ease-linear'
								style={{ width: `${Math.round(downloadProgress * 100)}%` }}
							/>
						</span>
					)}
				</Button>
			}>
			<div className='flex flex-col gap-4'>
				<Field>
					<div className='grid grid-cols-3 gap-2 mb-3'>
						{tabs.map((tab) => (
							<div key={tab.id} className='flex items-center gap-1'>
								<Button
									type='button'
									className='flex-1'
									variant={tab.id === activeTab ? 'default' : 'secondary'}
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
						))}
					</div>

					{isLoadingRows ? (
						<div className='rounded-md border p-8 flex items-center justify-center gap-2 text-sm'>
							<Spinner />
							<span>Loading versions...</span>
						</div>
					) : (
						<JarVersionSelectorPane
							tab={activeTab}
							rows={rows}
							installedMajors={installedMajors}
							isCheckingJavaCompatibility={isCheckingJavaCompatibility}
							selectedRowId={selectedRow?.id ?? null}
							onSelectRow={setSelectedRow}
						/>
					)}
				</Field>

				{isAdvancedMode && (
					<>
						<Field>
							<Label htmlFor='create-server-file'>Jar file location</Label>
							<div className='flex gap-2'>
								<Input
									id='create-server-file'
									placeholder='C:\\servers\\server-1.21.11.jar'
									value={form.file}
									onChange={(event) => {
										const nextFile = event.target.value;
										updateField('file', nextFile);
										applyInferredMetadata(nextFile);
									}}
								/>
								<Button type='button' variant='outline' onClick={onPickServerFile}>
									<FolderOpen /> Browse
								</Button>
							</div>
						</Field>
						<Field>
							<Label htmlFor='create-server-provider'>Server provider</Label>
							<Select
								value={form.provider}
								onValueChange={(value) => {
									if (!isServerProvider(value)) return;
									updateField('provider', value);
								}}>
								<SelectTrigger id='create-server-provider' className='w-full'>
									<SelectValue placeholder='Select provider' />
								</SelectTrigger>
								<SelectContent>
									{providerOptions.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className='text-xs text-muted-foreground'>
								{inferredProvider
									? `Detected from filename: ${inferredProvider}`
									: 'Provider could not be detected automatically from this filename.'}
							</p>
						</Field>
						<p className='text-sm text-amber-600'>
							Advanced mode is enabled. There may be issues if you select the incorrect provider.
						</p>
					</>
				)}
			</div>
		</SlideShell>
	);
};

export default SlideJarFile;
