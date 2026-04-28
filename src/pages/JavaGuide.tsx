import * as React from 'react';
import { m } from 'motion/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { AlertTriangle, Coffee, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { detectJavaRuntimes, type JavaRuntimeDetectionResult } from '@/lib/java-runtime-service';

const INSTALL_LINKS = [
	// {
	// 	label: 'Eclipse Temurin (Adoptium)',
	// 	url: 'https://adoptium.net/temurin/releases/',
	// 	description: 'Recommended OpenJDK distribution for most users.',
	// },
	{
		label: 'Microsoft Build of OpenJDK',
		url: 'https://learn.microsoft.com/java/openjdk/download',
		description: 'Good option if you prefer Microsoft-managed builds.',
	},
	{
		label: 'Oracle JDK',
		url: 'https://www.oracle.com/java/technologies/downloads/',
		description: 'Available with Oracle licensing terms.',
	},
];

const sourceLabel = (source: string) => {
	if (source === 'path') return 'PATH';
	if (source === 'java_home') return 'JAVA_HOME';
	if (source === 'common_install_dir') return 'Installed JDK folder';
	return source;
};

const JavaGuide: React.FC = () => {
	const [runtimeResult, setRuntimeResult] = React.useState<JavaRuntimeDetectionResult | null>(null);
	const [loadError, setLoadError] = React.useState<string | null>(null);
	const [isLoading, setIsLoading] = React.useState(true);
	const [isRefreshing, setIsRefreshing] = React.useState(false);

	const fetchRuntimes = React.useCallback(async (reason: 'initial' | 'refresh') => {
		if (reason === 'initial') {
			setIsLoading(true);
		} else {
			setIsRefreshing(true);
		}

		setLoadError(null);

		try {
			const result = await detectJavaRuntimes();
			setRuntimeResult(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to detect Java runtimes.';
			setLoadError(message);
		} finally {
			setIsLoading(false);
			setIsRefreshing(false);
		}
	}, []);

	React.useEffect(() => {
		void fetchRuntimes('initial');
	}, [fetchRuntimes]);

	return (
		<main className='h-full px-12 py-18 w-full overflow-y-auto app-scroll-area'>
			<div className='mx-auto w-full max-w-6xl space-y-6'>
				<m.section
					initial={{ scale: 0.75, y: 10, opacity: 0 }}
					whileInView={{ scale: 1, y: 0, opacity: 1 }}
					transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
					className='flex flex-col items-center text-center'>
					<Coffee className='size-20 mb-6' />
					<h1 className='text-3xl font-bold mb-2'>Java Version Guide</h1>
					<p className='max-w-3xl'>
						This page detects your installed Java versions and tells you how to install a JDK.
					</p>
					<div className='mt-6 flex flex-wrap justify-center gap-2'>
						<Button onClick={() => void fetchRuntimes('refresh')} disabled={isLoading || isRefreshing}>
							{isRefreshing ? <Spinner /> : <RefreshCw />}
							Rescan Java
						</Button>
					</div>
				</m.section>

				<m.section
					initial={{ scale: 0.75, y: 10, opacity: 0 }}
					whileInView={{ scale: 1, y: 0, opacity: 1 }}
					transition={{ type: 'spring', duration: 0.5, bounce: 0 }}>
					<p className='text-xl font-bold'>Detected Java Runtimes</p>
					<p>
						Auto-detected{' '}
						{runtimeResult && <span> {runtimeResult.scannedCandidates} Java executable(s)</span>} from
						PATH, JAVA_HOME, and common install folders.{' '}
					</p>
					<div className='space-y-4 mt-3'>
						{isLoading && (
							<div className='rounded-lg border p-6 flex items-center gap-3'>
								<Spinner />
								<p>Scanning your system for Java runtimes...</p>
							</div>
						)}

						{!isLoading && loadError && (
							<div className='rounded-lg border border-destructive/60 p-4 text-destructive'>
								<p className='font-semibold'>Failed to detect Java runtimes</p>
								<p className='text-sm mt-1'>{loadError}</p>
							</div>
						)}

						{!isLoading && !loadError && runtimeResult && runtimeResult.runtimes.length === 0 && (
							<div className='rounded-lg border border-yellow-500/60 p-4'>
								<p className='font-semibold text-yellow-600 dark:text-yellow-400'>
									No Java runtime found
								</p>
								<p className='text-sm mt-1'>Install Java first, then click Rescan Java.</p>
							</div>
						)}

						{!isLoading &&
							!loadError &&
							runtimeResult &&
							runtimeResult.runtimes.map((runtime) => (
								<div key={runtime.executablePath} className='rounded-lg border p-4 space-y-1'>
									<div className='flex flex-wrap items-center gap-2'>
										<p className='font-semibold'>
											Java {runtime.majorVersion}
											<span className='text-muted-foreground'>
												{runtime.version.replace(String(runtime.majorVersion), '')}
											</span>
										</p>
										{runtime.vendor !== 'Unknown' && (
											<span className='text-xs rounded-full bg-accent text-accent-foreground px-2 py-1'>
												{runtime.vendor}
											</span>
										)}
										<span className='text-xs rounded-full bg-accent text-accent-foreground px-2 py-1'>
											{sourceLabel(runtime.source)}
										</span>
									</div>
									<p className='text-sm text-muted-foreground break-all'>{runtime.executablePath}</p>
								</div>
							))}

						{runtimeResult && runtimeResult.errors.length > 0 && (
							<Accordion type='single' collapsible>
								<AccordionItem value='java-errors'>
									<AccordionTrigger>
										Detection warnings ({runtimeResult.errors.length})
									</AccordionTrigger>
									<AccordionContent className='space-y-1'>
										{runtimeResult.errors.map((error) => (
											<p key={error} className='text-sm text-muted-foreground'>
												- {error}
											</p>
										))}
									</AccordionContent>
								</AccordionItem>
							</Accordion>
						)}
					</div>
				</m.section>

				<m.section
					initial={{ scale: 0.75, y: 10, opacity: 0 }}
					whileInView={{ scale: 1, y: 0, opacity: 1 }}
					transition={{ type: 'spring', duration: 0.5, bounce: 0 }}>
					<p className='text-xl font-bold'>Install Java JDK (Guided)</p>
					<p>This app does not auto-install Java. Installation is always user-confirmed.</p>
					<div className='space-y-4 mt-3'>
						<div className='rounded-lg border p-4'>
							<p className='font-semibold mb-2'>Step-by-step</p>
							<ol className='text-sm space-y-1'>
								<li>1. Download a Java JDK from one of the links below.</li>
								<li>2. Run the installer and keep default options.</li>
								<li>3. Restart mserve.</li>
								<li>4. Return to this page and click Rescan Java.</li>
								<li>5. If multiple Java versions exist, set your preferred default in Settings.</li>
							</ol>
						</div>

						<div className='grid gap-3 md:grid-cols-2'>
							{INSTALL_LINKS.map((link) => (
								<div key={link.url} className='rounded-lg border p-4'>
									<p className='font-semibold'>{link.label}</p>
									<p className='text-sm text-muted-foreground mt-1'>{link.description}</p>
									<Button className='mt-3' onClick={() => openUrl(link.url)}>
										Open download page
										<ExternalLink className='size-4' />
									</Button>
								</div>
							))}
						</div>

						<Accordion type='single' collapsible>
							<AccordionItem value='install-notes'>
								<AccordionTrigger>Important things to know</AccordionTrigger>
								<AccordionContent className='space-y-2 text-sm'>
									<p>- Prefer 64-bit Java builds on modern Windows systems.</p>
									<p>
										- If a server needs a specific Java executable, set a per-server Java override
										in server settings.
									</p>
									<p>
										- Very old server builds may require Java 8 and can fail on newer Java releases.
									</p>
									<p>
										- If nothing is detected after install, restart the app so PATH/JAVA_HOME
										changes are picked up.
									</p>
								</AccordionContent>
							</AccordionItem>
						</Accordion>
					</div>
				</m.section>

				{runtimeResult && runtimeResult.runtimes.length === 0 && !isLoading && !loadError && (
					<m.section
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, bounce: 0 }}>
						<Card className='border-red-500/60 bg-red-500/5'>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<AlertTriangle className='size-5 text-red-500' />
									No Java detected
								</CardTitle>
								<CardDescription>Install Java before starting servers in mserve.</CardDescription>
							</CardHeader>
							<CardContent className='space-y-2 text-sm'>
								<p>- First action: install Temurin Java.</p>
								<p>- Second action: restart mserve and click Rescan Java.</p>
								<p>- Third action: verify each server card above shows compatible.</p>
							</CardContent>
						</Card>
					</m.section>
				)}
			</div>
		</main>
	);
};

export default JavaGuide;
