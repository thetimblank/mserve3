import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { ArrowRight, CircleHelp, Download, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUser } from '@/data/user';
import { resolveJavaRequirement } from '@/lib/java-compatibility';
import {
	downloadJarRow,
	fetchJarRows,
	getJarTabs,
	isJarRowDownloadable,
	toProviderFromJarRow,
	type DownloadServerJarProgressEvent,
	type JarTab,
	type JarVersionRow,
} from '@/lib/jar-download-service';
import {
	detectJavaRuntimes,
	resolveJavaRuntimeForRequirement,
	type JavaRuntimeInfo,
} from '@/lib/java-runtime-service';
import { inferProviderFromJarPath, inferVersionFromJarPath } from '@/lib/server-provider-capabilities';
import {
	createProvider,
	getProviderDisplayName,
	isServerProvider,
	PROVIDER_NAMES,
} from '@/lib/server-provider';
import { useCreateServer, type PathValidationResult } from '../CreateServerContext';
import JarVersionSelectorPane from './components/JarVersionSelectorPane';
import SlideShell from './SlideShell';

const parseJdkVersions = (value: string): number[] =>
	Array.from(
		new Set(
			value
				.split(',')
				.map((token) => Number(token.trim()))
				.filter((token) => Number.isInteger(token) && token > 0),
		),
	);

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

	const maybeApplyJavaOverride = React.useCallback(
		(providerId: string, version: string) => {
			const requirement = resolveJavaRequirement(providerId, version);
			const runtime = resolveJavaRuntimeForRequirement(runtimes, requirement);
			if (!runtime) return;
			updateField('java_installation', runtime.executablePath);
		},
		[runtimes, updateField],
	);

	const applyInferredMetadata = React.useCallback(
		(filePath: string) => {
			const providerName = inferProviderFromJarPath(filePath);
			const version = inferVersionFromJarPath(filePath);

			if (!providerName && !form.provider) {
				return;
			}

			const base = providerName
				? createProvider(providerName)
				: (form.provider ?? createProvider('vanilla'));

			const nextProvider = {
				...base,
				file: filePath,
				minecraft_version: version ?? base.minecraft_version,
				provider_version: version ?? base.provider_version,
			};

			updateField('provider', nextProvider);

			if (providerName && version) {
				maybeApplyJavaOverride(providerName, version);
			}
		},
		[form.provider, maybeApplyJavaOverride, updateField],
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
		if (isDownloading) return;

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
							if (event.payload.downloadId !== downloadId) return;

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

					const provider = {
						...toProviderFromJarRow(selectedRow),
						file: result.path,
					};

					setDownloadProgress(1);
					updateField('file', result.path);
					updateField('provider', provider);
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

			if (!form.provider) {
				setError('Provider details are required for manual jar selection.');
				return;
			}

			const provider = {
				...form.provider,
				file,
			};

			if (!provider.minecraft_version.trim() || !provider.provider_version.trim()) {
				setError('Fill provider minecraft version and provider version before continuing.');
				return;
			}

			updateField('provider', provider);
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
					{form.file.length > 0 ? (
						<>
							Continue <ArrowRight />
						</>
					) : isDownloading ? (
						<>
							<Spinner /> Downloading & Continuing...
						</>
					) : (
						<>
							<Download /> Download & Continue
						</>
					)}
					{isDownloading && (
						<span className='pointer-events-none absolute inset-x-0 bottom-0 h-1 w-full bg-accent/20'>
							<span
								className='block h-full bg-accent transition-[width] duration-150 ease-linear'
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
									placeholder='C:\servers\server-1.21.11.jar'
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
								value={form.provider?.name ?? ''}
								onValueChange={(value) => {
									if (!isServerProvider(value)) return;
									const base = createProvider(value);
									const existing = form.provider;
									updateField('provider', {
										...base,
										file: form.file || existing?.file || base.file,
										minecraft_version: existing?.minecraft_version || base.minecraft_version,
										provider_version: existing?.provider_version || base.provider_version,
										jdk_versions: existing?.jdk_versions.length
											? existing.jdk_versions
											: base.jdk_versions,
										supported_telemetry: existing?.supported_telemetry.length
											? existing.supported_telemetry
											: base.supported_telemetry,
										stable: existing?.stable ?? base.stable,
										download_url: existing?.download_url ?? base.download_url,
									});
								}}>
								<SelectTrigger id='create-server-provider' className='w-full'>
									<SelectValue placeholder='Select provider' />
								</SelectTrigger>
								<SelectContent>
									{PROVIDER_NAMES.map((option) => (
										<SelectItem key={option} value={option}>
											{getProviderDisplayName(option)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className='text-xs text-muted-foreground'>
								{inferredProvider
									? `Detected from filename: ${getProviderDisplayName(inferredProvider)}`
									: 'Provider could not be detected automatically from this filename.'}
							</p>
						</Field>

						<Field>
							<Label htmlFor='create-server-mc-version'>Minecraft version</Label>
							<Input
								id='create-server-mc-version'
								placeholder='1.21.11'
								value={form.provider?.minecraft_version ?? inferredVersion ?? ''}
								onChange={(event) => {
									if (!form.provider) return;
									updateField('provider', {
										...form.provider,
										minecraft_version: event.target.value,
									});
								}}
							/>
						</Field>

						<Field>
							<Label htmlFor='create-server-provider-version'>Provider version</Label>
							<Input
								id='create-server-provider-version'
								placeholder='130'
								value={form.provider?.provider_version ?? inferredVersion ?? ''}
								onChange={(event) => {
									if (!form.provider) return;
									updateField('provider', {
										...form.provider,
										provider_version: event.target.value,
									});
								}}
							/>
						</Field>

						<Field>
							<Label htmlFor='create-server-provider-jdks'>
								Supported JDK versions (comma separated)
							</Label>
							<Input
								id='create-server-provider-jdks'
								placeholder='17, 21'
								value={(form.provider?.jdk_versions ?? [21]).join(', ')}
								onChange={(event) => {
									if (!form.provider) return;
									updateField('provider', {
										...form.provider,
										jdk_versions: parseJdkVersions(event.target.value),
									});
								}}
							/>
						</Field>

						<Field>
							<Label className='flex items-center gap-3'>
								<Checkbox
									checked={form.provider?.stable ?? true}
									onCheckedChange={(checked) => {
										if (!form.provider) return;
										updateField('provider', {
											...form.provider,
											stable: typeof checked === 'boolean' ? checked : false,
										});
									}}
								/>
								Stable provider build
							</Label>
						</Field>
						<p className='text-sm text-amber-600'>
							Advanced mode is enabled. Manual jar flow requires complete provider metadata.
						</p>
					</>
				)}
			</div>
		</SlideShell>
	);
};

export default SlideJarFile;
