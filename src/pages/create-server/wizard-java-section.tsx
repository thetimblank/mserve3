import * as React from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { CircleCheck, Download, FolderOpen, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import JavaRuntimeSelect from '@/components/java-runtime-select';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useJavaRuntimes } from '@/data/java-runtimes';
import { useExperience, useUser } from '@/data/user';
import { isJavaCompatible } from '@/lib/java-compatibility';
import { resolveServerJavaExecutable, type JavaProviderRef } from '@/lib/java-resolution';
import { downloadJavaRuntime, type JavaDownloadProgressEvent } from '@/lib/java-runtime-service';
import { examplePaths } from '@/lib/platform';
import { getErrorMessage } from '@/lib/utils';

type WizardJavaSectionProps = {
	/** The picked version's provider + Minecraft version; null until one is picked. */
	target: JavaProviderRef | null;
	/** The form's `java_installation` ('' = automatic). */
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
};

type DownloadState = { majorVersion: number; progress: number };

// Downloads outlive the section (leaving the slide unmounts it), so a second
// click after coming back joins the running download instead of starting another.
const inFlightDownloads = new Map<number, Promise<unknown>>();

/** Downloads a Temurin runtime in place (no dialog), then rescans the installed runtimes. */
const useInlineJavaDownload = () => {
	const { rescan } = useJavaRuntimes();
	const [download, setDownload] = React.useState<DownloadState | null>(null);

	const start = React.useCallback(
		async (majorVersion: number) => {
			setDownload({ majorVersion, progress: 0 });
			let unlisten: UnlistenFn | null = null;
			try {
				unlisten = await listen<JavaDownloadProgressEvent>('java-download-progress', (event) => {
					if (event.payload.majorVersion !== majorVersion) return;
					setDownload({ majorVersion, progress: event.payload.progress });
				});
				let pending = inFlightDownloads.get(majorVersion);
				if (!pending) {
					pending = downloadJavaRuntime(majorVersion).finally(() => {
						inFlightDownloads.delete(majorVersion);
					});
					inFlightDownloads.set(majorVersion, pending);
				}
				await pending;
				await rescan();
				toast.success(`Java ${majorVersion} is installed.`);
			} catch (err) {
				toast.error(getErrorMessage(err, 'Java download failed.'));
			} finally {
				unlisten?.();
				setDownload(null);
			}
		},
		[rescan],
	);

	return { download, start };
};

/**
 * The version slide's Java section. Beginners get automatic Java with an inline
 * download when nothing compatible is installed; Standard adds picking a detected
 * runtime; Advanced adds a manual executable path.
 */
const WizardJavaSection: React.FC<WizardJavaSectionProps> = ({ target, value, onChange, disabled }) => {
	const { runtimes, isLoading } = useJavaRuntimes();
	const { user } = useUser();
	const { isBeginner, isAdvanced } = useExperience();
	const { download, start } = useInlineJavaDownload();

	// What "Automatic" resolves to for this version, ignoring the per-server pin.
	const automatic = React.useMemo(
		() =>
			target
				? resolveServerJavaExecutable({
						provider: target,
						javaInstallation: '',
						globalDefault: user.java_installation_default,
						runtimes,
					})
				: null,
		[runtimes, target, user.java_installation_default],
	);

	const pinned = value.trim() !== '';
	const neededMajor = automatic?.requirement.recommendedMajor ?? null;
	const automaticWorks =
		automatic?.status === 'resolved' &&
		(automatic.majorVersion === null || isJavaCompatible(automatic.majorVersion, automatic.requirement));

	const onBrowseJava = async () => {
		try {
			const selected = await openDialog({ directory: false, multiple: false, title: 'Choose a Java executable' });
			if (typeof selected === 'string') onChange(selected);
		} catch (err) {
			toast.error(getErrorMessage(err, 'Could not open file picker.'));
		}
	};

	const renderAutomaticStatus = () => {
		if (!target || !automatic || neededMajor === null) {
			return <p className='text-sm text-muted-foreground'>Pick a version to see which Java it needs.</p>;
		}

		if (isLoading) {
			return (
				<p className='flex items-center gap-2 text-sm text-muted-foreground'>
					<Spinner /> Checking installed Java...
				</p>
			);
		}

		if (automaticWorks) {
			return (
				<p className='flex items-center gap-2 text-sm'>
					<CircleCheck className='size-4 text-green-500' />
					{automatic.status === 'resolved' && automatic.majorVersion !== null
						? `Java ${automatic.majorVersion} will be used automatically.`
						: 'Your default Java will be used automatically.'}
				</p>
			);
		}

		return (
			<div className='flex flex-wrap items-center justify-between gap-3'>
				<p className='flex items-center gap-2 text-sm'>
					<TriangleAlert className='size-4 shrink-0 text-amber-500' />
					This version needs Java {neededMajor}, which isn&apos;t installed.
				</p>
				<Button
					type='button'
					onClick={() => void start(neededMajor)}
					disabled={disabled || download !== null}
					className='relative overflow-hidden'>
					{download ? (
						<>
							<Spinner /> Downloading Java {download.majorVersion}...
						</>
					) : (
						<>
							<Download /> Download Java {neededMajor}
						</>
					)}
					{download && (
						<span className='pointer-events-none absolute inset-x-0 bottom-0 h-1 w-full bg-accent/20'>
							<span
								className='block h-full bg-accent transition-[width] duration-150 ease-linear'
								style={{ width: `${Math.round(download.progress * 100)}%` }}
							/>
						</span>
					)}
				</Button>
			</div>
		);
	};

	return (
		<Container className='flex flex-col gap-4'>
			<div>
				<p className='font-semibold'>Java</p>
				<p className='text-sm text-muted-foreground'>
					{isBeginner
						? 'mserve picks a compatible Java for you.'
						: 'Automatic picks the best installed Java for this version.'}
				</p>
			</div>

			{!isBeginner && (
				<div className='flex flex-col gap-2'>
					<Label htmlFor='create-server-java'>Java runtime</Label>
					<JavaRuntimeSelect
						id='create-server-java'
						provider={target}
						javaRuntimes={runtimes}
						value={value}
						onChange={onChange}
						disabled={disabled}
					/>
				</div>
			)}

			{isBeginner && pinned ? (
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<p className='text-sm'>A specific Java runtime is selected for this server.</p>
					<Button type='button' variant='secondary' onClick={() => onChange('')} disabled={disabled}>
						Use automatic
					</Button>
				</div>
			) : (
				!pinned && renderAutomaticStatus()
			)}

			{isAdvanced && (
				<div className='flex flex-col gap-2'>
					<Label htmlFor='create-server-java-path'>Java executable path</Label>
					<div className='flex gap-2'>
						<Input
							id='create-server-java-path'
							placeholder={examplePaths.javaExecutable}
							value={value}
							onChange={(event) => onChange(event.target.value)}
							disabled={disabled}
						/>
						<Button type='button' variant='secondary' onClick={onBrowseJava} disabled={disabled}>
							<FolderOpen /> Browse
						</Button>
					</div>
					<p className='text-xs text-muted-foreground'>Leave empty to pick automatically.</p>
				</div>
			)}
		</Container>
	);
};

export default WizardJavaSection;
