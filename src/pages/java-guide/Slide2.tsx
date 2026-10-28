import { SlideFrame, useSlideshow } from '@/components/slideshow';
import { m } from 'motion/react';
import { Spinner } from '@/components/ui/spinner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { useUser } from '@/data/user';
import { useJavaRuntimes } from '@/data/java-runtimes';

export default function Slide2() {
	const { nextSlide } = useSlideshow();
	const { user } = useUser();
	const { runtimes, warnings, scannedCandidates, isLoading, error, rescan } = useJavaRuntimes();

	const sourceLabel = (source: string) => {
		if (source === 'path') return 'PATH';
		if (source === 'java_home') return 'JAVA_HOME';
		if (source === 'common_install_dir') return 'Installed JDK folder';
		if (source === 'managed') return 'Downloaded by mserve';
		return source;
	};

	return (
		<SlideFrame className='flex flex-col items-center max-w-lg'>
			<p className='text-center text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>
				Detected Java Runtimes
			</p>
			<p className='mb-20 text-center'>
				Found{' '}
				{!isLoading && (
					<span>
						{scannedCandidates} Java executable{scannedCandidates !== 1 && 's'}
					</span>
				)}
				{user.advanced_mode ? ' from PATH, JAVA_HOME, and common install folders.' : '.'}
			</p>
			<div className='flex flex-col items-center'>
				{isLoading && (
					<div className='rounded-lg border-2 p-6 flex items-center gap-3'>
						<Spinner />
						<p>Scanning your system for Java runtimes...</p>
					</div>
				)}

				{!isLoading && error && (
					<div className='rounded-lg border-2 border-destructive/60 p-4 text-destructive'>
						<p className='font-semibold'>Failed to detect Java runtimes</p>
						<p className='text-sm mt-1'>{error}</p>
					</div>
				)}

				{!isLoading && !error && runtimes.length === 0 && (
					<div className='rounded-lg border-2 border-yellow-500/60 p-4'>
						<p className='font-semibold text-yellow-600 dark:text-yellow-400'>No Java runtime found</p>
						<p className='text-sm mt-1'>Install Java first, then click Rescan Java.</p>
					</div>
				)}

				{!isLoading &&
					!error &&
					runtimes.map((runtime) => (
						<Container key={runtime.executablePath} className='space-y-1 p-4 mb-2 w-full'>
							<div className='flex flex-wrap items-center gap-2'>
								<p className='font-semibold'>
									Java {runtime.majorVersion}
									<span className='text-muted-foreground'>
										{runtime.version.replace(String(runtime.majorVersion), '')}
									</span>
								</p>
								<span className='text-xs rounded-full bg-accent text-accent-foreground px-2 py-1'>
									{sourceLabel(runtime.source)}
								</span>
							</div>
							<p className='text-sm text-muted-foreground break-all'>{runtime.executablePath}</p>
						</Container>
					))}

				{runtimes.length === 0 && !isLoading && !error && (
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
								<p>1. Install Java</p>
								<p>2. Click Rescan Java (or restart mserve)</p>
								<p>3. Verify each that your sever can run that JDK</p>
							</CardContent>
						</Card>
					</m.section>
				)}

				{warnings.length > 0 && (
					<Accordion type='single' collapsible>
						<AccordionItem value='java-errors'>
							<AccordionTrigger>Detection warnings ({warnings.length})</AccordionTrigger>
							<AccordionContent className='space-y-1'>
								{warnings.map((warning) => (
									<p key={warning} className='text-sm text-muted-foreground'>
										- {warning}
									</p>
								))}
							</AccordionContent>
						</AccordionItem>
					</Accordion>
				)}
				<div className='mt-4 ml-auto flex gap-2'>
					<Button variant='secondary' onClick={() => void rescan()} disabled={isLoading}>
						<RefreshCcw className={isLoading ? 'animate-spin' : undefined} />
						Rescan Java
					</Button>
					<Button onClick={nextSlide}>Continue</Button>
				</div>
			</div>
		</SlideFrame>
	);
}
