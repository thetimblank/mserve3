import React from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useNavigate } from 'react-router-dom';
import { Download, ExternalLink, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {
	downloadJavaRuntime,
	type JavaDownloadProgressEvent,
	type JavaRuntimeInfo,
} from '@/lib/java-runtime-service';
import { useJavaRuntimes } from '@/data/java-runtimes';
import { resolveServerJavaExecutable } from '@/lib/java-resolution';
import { useUser } from '@/data/user';
import type { Server } from '@/data/servers';

type EnsureJavaContextValue = {
	/**
	 * Ensures a Java runtime for `majorVersion` is available, prompting the user
	 * to download Eclipse Temurin (with a Java-guide fallback). Resolves to the
	 * installed runtime, or null if the user cancelled / chose the guide.
	 */
	ensureJava: (majorVersion: number) => Promise<JavaRuntimeInfo | null>;
};

const JavaDownloadContext = React.createContext<EnsureJavaContextValue | undefined>(undefined);

type Phase = 'confirm' | 'downloading' | 'error';

type DialogState = {
	open: boolean;
	majorVersion: number;
	phase: Phase;
	progress: number;
	error: string | null;
};

const initialState: DialogState = {
	open: false,
	majorVersion: 0,
	phase: 'confirm',
	progress: 0,
	error: null,
};

export const JavaDownloadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const navigate = useNavigate();
	const { rescan } = useJavaRuntimes();
	const [state, setState] = React.useState<DialogState>(initialState);
	const resolverRef = React.useRef<((runtime: JavaRuntimeInfo | null) => void) | null>(null);

	const settle = React.useCallback((runtime: JavaRuntimeInfo | null) => {
		const resolve = resolverRef.current;
		resolverRef.current = null;
		setState((prev) => ({ ...prev, open: false }));
		resolve?.(runtime);
	}, []);

	const ensureJava = React.useCallback((majorVersion: number) => {
		// A previous request is superseded — resolve it as cancelled.
		resolverRef.current?.(null);
		return new Promise<JavaRuntimeInfo | null>((resolve) => {
			resolverRef.current = resolve;
			setState({ open: true, majorVersion, phase: 'confirm', progress: 0, error: null });
		});
	}, []);

	const startDownload = React.useCallback(
		async (majorVersion: number) => {
			setState((prev) => ({ ...prev, phase: 'downloading', progress: 0, error: null }));
			try {
				const runtime = await downloadJavaRuntime(majorVersion);
				await rescan();
				settle(runtime);
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Java download failed.';
				setState((prev) => ({ ...prev, phase: 'error', error: message }));
			}
		},
		[rescan, settle],
	);

	// Live download progress for the active major version.
	React.useEffect(() => {
		if (state.phase !== 'downloading') return;
		let unlisten: UnlistenFn | undefined;
		let active = true;

		void listen<JavaDownloadProgressEvent>('java-download-progress', (event) => {
			if (!active) return;
			if (event.payload.majorVersion !== state.majorVersion) return;
			setState((prev) => ({ ...prev, progress: event.payload.progress }));
		}).then((fn) => {
			if (active) unlisten = fn;
			else fn();
		});

		return () => {
			active = false;
			unlisten?.();
		};
	}, [state.phase, state.majorVersion]);

	const handleOpenGuide = React.useCallback(() => {
		navigate('/java-guide', { state: { requiredMajor: state.majorVersion } });
		settle(null);
	}, [navigate, settle, state.majorVersion]);

	const handleOpenChange = React.useCallback(
		(open: boolean) => {
			if (open) return;
			if (state.phase === 'downloading') return; // don't cancel mid-download
			settle(null);
		},
		[settle, state.phase],
	);

	const value = React.useMemo<EnsureJavaContextValue>(() => ({ ensureJava }), [ensureJava]);

	return (
		<JavaDownloadContext.Provider value={value}>
			{children}
			<Dialog open={state.open} onOpenChange={handleOpenChange}>
				<DialogContent showCloseButton={state.phase !== 'downloading'}>
					<DialogHeader>
						<DialogTitle>Java {state.majorVersion} is required</DialogTitle>
						<DialogDescription>
							This server needs Java {state.majorVersion}, which isn't installed. mserve can download
							the Eclipse Temurin build for you, or you can install it yourself from the Java guide.
						</DialogDescription>
					</DialogHeader>

					{state.phase === 'downloading' && (
						<div className='space-y-2'>
							<div className='flex items-center gap-2 text-sm text-muted-foreground'>
								<Download className='size-4' />
								Downloading Java {state.majorVersion}…
							</div>
							<div className='h-2 w-full overflow-hidden rounded-full bg-border'>
								<div
									className='h-full rounded-full bg-green-500 transition-all'
									style={{ width: `${Math.round(state.progress * 100)}%` }}
								/>
							</div>
						</div>
					)}

					{state.phase === 'error' && (
						<div className='flex items-start gap-2 rounded-md border-2 border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive'>
							<TriangleAlert className='mt-0.5 size-4 shrink-0' />
							<span>{state.error}</span>
						</div>
					)}

					<DialogFooter>
						<Button type='button' variant='outline' onClick={handleOpenGuide}>
							<ExternalLink className='size-4' />
							Open Java guide
						</Button>
						{state.phase !== 'downloading' && (
							<Button type='button' onClick={() => void startDownload(state.majorVersion)}>
								<Download className='size-4' />
								{state.phase === 'error' ? 'Retry download' : `Download Java ${state.majorVersion}`}
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</JavaDownloadContext.Provider>
	);
};

export const useJavaDownload = (): EnsureJavaContextValue => {
	const context = React.useContext(JavaDownloadContext);
	if (!context) {
		throw new Error('useJavaDownload must be used within a JavaDownloadProvider');
	}
	return context;
};

/**
 * Resolves the Java executable to launch a server with, prompting to download a
 * missing version when needed. Returns the path, or null if it couldn't be
 * resolved (user cancelled / chose the Java guide). Shared by every quick-start
 * surface (server card, network canvas) so they behave identically.
 */
export const useServerJavaResolver = () => {
	const { user } = useUser();
	const { runtimes } = useJavaRuntimes();
	const { ensureJava } = useJavaDownload();

	return React.useCallback(
		async (server: Pick<Server, 'provider' | 'java_installation'>): Promise<string | null> => {
			const resolution = resolveServerJavaExecutable({
				provider: server.provider,
				javaInstallation: server.java_installation,
				globalDefault: user.java_installation_default,
				runtimes,
			});

			if (resolution.status === 'resolved') {
				return resolution.executablePath;
			}

			const runtime = await ensureJava(resolution.requirement.recommendedMajor);
			return runtime?.executablePath ?? null;
		},
		[ensureJava, runtimes, user.java_installation_default],
	);
};
