import * as React from 'react';
import { m } from 'motion/react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Download, ExternalLink } from 'lucide-react';
import { useSlide } from './SlideContext';
import { Container } from '@/components/ui/container';
import { Spinner } from '@/components/ui/spinner';
import { downloadJavaRuntime } from '@/lib/java-runtime-service';
import { useJavaRuntimes } from '@/data/java-runtimes';

// Eclipse Temurin is OpenJDK under GPLv2 + Classpath Exception and is freely
// redistributable, so mserve can fetch it directly.
const DOWNLOADABLE_MAJORS: { major: number; label: string }[] = [
	{ major: 25, label: 'Latest (Minecraft 26+)' },
	{ major: 21, label: 'Recommended (1.20.5 - 1.21+)' },
	{ major: 17, label: '1.18 - 1.20.4' },
	{ major: 8, label: 'Legacy (1.16.5 and older)' },
];

const INSTALL_LINKS = [
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

export default function Slide3() {
	const { nextSlide } = useSlide();
	const { rescan } = useJavaRuntimes();
	const location = useLocation();
	const requiredMajor = (location.state as { requiredMajor?: number } | null)?.requiredMajor ?? null;
	const [downloadingMajor, setDownloadingMajor] = React.useState<number | null>(null);

	const handleDownload = async (major: number) => {
		if (downloadingMajor !== null) return;
		setDownloadingMajor(major);
		const toastId = toast.loading(`Downloading Java ${major} (Eclipse Temurin)…`);
		try {
			await downloadJavaRuntime(major);
			await rescan();
			toast.success(`Java ${major} installed.`, { id: toastId });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : `Failed to download Java ${major}.`, {
				id: toastId,
			});
		} finally {
			setDownloadingMajor(null);
		}
	};

	return (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='flex flex-col items-center'>
			<p className='text-3xl text-center font-bold flex gap-5 items-center mb-2 w-fit'>Install Java</p>
			<p className='mb-12 text-center max-w-lg'>
				mserve can download Eclipse Temurin (OpenJDK) for you, or you can install another build manually.
				{requiredMajor ? ` This server needs Java ${requiredMajor}.` : ''}
			</p>

			<div className='flex flex-col items-stretch gap-6 w-full max-w-2xl'>
				<Container>
					<p className='font-semibold mb-1'>Download with mserve (recommended)</p>
					<p className='text-sm text-muted-foreground mb-3'>
						One click — installed Temurin builds show up automatically in your Java picker.
					</p>
					<div className='grid gap-2 sm:grid-cols-2'>
						{DOWNLOADABLE_MAJORS.map(({ major, label }) => (
							<Button
								key={major}
								variant={requiredMajor === major ? 'default' : 'secondary'}
								className='justify-between'
								disabled={downloadingMajor !== null}
								onClick={() => void handleDownload(major)}>
								<span>
									Java {major}
									<span className='ml-2 text-xs opacity-70'>{label}</span>
								</span>
								{downloadingMajor === major ? (
									<Spinner className='size-4' />
								) : (
									<Download className='size-4' />
								)}
							</Button>
						))}
					</div>
				</Container>

				<Container>
					<p className='font-semibold mb-2'>Install manually</p>
					<div className='grid gap-3 md:grid-cols-2'>
						{INSTALL_LINKS.map((link) => (
							<div key={link.url}>
								<p className='font-medium'>{link.label}</p>
								<p className='text-sm text-muted-foreground mt-1'>{link.description}</p>
								<Button variant='outline' className='mt-3' onClick={() => openUrl(link.url)}>
									Open download page
									<ExternalLink className='size-4' />
								</Button>
							</div>
						))}
					</div>
				</Container>

				<Accordion type='single' collapsible>
					<AccordionItem value='install-notes'>
						<AccordionTrigger>Extra Help</AccordionTrigger>
						<AccordionContent className='space-y-2 text-sm'>
							<p>- Automatic downloads use 64-bit Eclipse Temurin builds.</p>
							<p>- Very old server builds may require Java 8 and can fail on newer Java releases.</p>
							<p>
								- If a manually installed Java isn't detected, restart the app so changes are picked
								up.
							</p>
						</AccordionContent>
					</AccordionItem>
				</Accordion>

				<Button className='ml-auto' onClick={nextSlide}>
					Continue
				</Button>
			</div>
		</m.div>
	);
}
