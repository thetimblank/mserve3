import { m } from 'motion/react';
import { Button } from '@/components/ui/button';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ExternalLink } from 'lucide-react';
import { useSlide } from './SlideContext';
import { Container } from '@/components/ui/container';

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

export default function Slide2() {
	const { nextSlide } = useSlide();

	return (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='flex flex-col items-center'>
			<p className='text-3xl text-center font-bold flex gap-5 items-center mb-2 w-fit'>
				Install Java JDK (Guided)
			</p>
			<p className='mb-20 text-center'>
				This app does not auto-install Java. Installation is always user-confirmed.
			</p>
			<div className='flex flex-col items-start'>
				<div className='space-y-4 mt-3'>
					<Container>
						<p className='font-semibold mb-2'>Step-by-step</p>
						<ol className='text-sm space-y-1'>
							<li>1. Download a Java JDK from one of the links below.</li>
							<li>2. Run the installer and keep default options.</li>
							<li>3. Restart mserve.</li>
							<li>4. Return to this page and click Rescan Java.</li>
							<li>5. If multiple Java versions exist, set your preferred default in Settings.</li>
						</ol>
					</Container>

					<div className='grid gap-3 md:grid-cols-2'>
						{INSTALL_LINKS.map((link) => (
							<Container key={link.url}>
								<p className='font-semibold'>{link.label}</p>
								<p className='text-sm text-muted-foreground mt-1'>{link.description}</p>
								<Button className='mt-3' onClick={() => openUrl(link.url)}>
									Open download page
									<ExternalLink className='size-4' />
								</Button>
							</Container>
						))}
					</div>

					<Accordion type='single' collapsible>
						<AccordionItem value='install-notes'>
							<AccordionTrigger>Important things to know</AccordionTrigger>
							<AccordionContent className='space-y-2 text-sm'>
								<p>- Prefer 64-bit Java builds on modern Windows systems.</p>
								<p>
									- If a server needs a specific Java executable, set a per-server Java override in
									server settings.
								</p>
								<p>
									- Very old server builds may require Java 8 and can fail on newer Java releases.
								</p>
								<p>
									- If nothing is detected after install, restart the app so PATH/JAVA_HOME changes
									are picked up.
								</p>
							</AccordionContent>
						</AccordionItem>
					</Accordion>
				</div>
				<Button className='mt-4 ml-auto' onClick={nextSlide}>
					Continue
				</Button>
			</div>
		</m.div>
	);
}
