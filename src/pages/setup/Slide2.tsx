import { m } from 'motion/react';
import { Button } from '@/components/ui/button';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface Props {
	nextSlide: () => void;
}

export default function Slide2({ nextSlide }: Props) {
	return (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='flex flex-col items-center text-center'>
			<p className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>
				2. Setup Port Forwarding on your Network
			</p>
			<p className='mb-20'>This will allow your server to be seen by other players. (Part 2/2)</p>
			<div className='flex flex-col items-start text-start'>
				<p className='mb-4'>
					You may have to forward port 25565 on your network. <br /> Please login to your network
					dashboard and look for port forwarding.
					<br />{' '}
					<span className='text-sm text-muted-foreground'>Dont worry, this is the hardest step.</span>
				</p>
				<Accordion type='single' collapsible className='w-[50vw]'>
					<AccordionItem value='1'>
						<AccordionTrigger>Common flow.</AccordionTrigger>
						<AccordionContent className='flex flex-col items-start'>
							{[
								'https://www.xfinity.com/support/articles/xfi-port-forwarding',
								'https://www.spectrum.net/support/internet/advanced-wifi-advanced-settings',
								'https://www.att.com/support/article/u-verse-high-speed-internet/KM1206322/',
								'https://www.verizon.com/support/knowledge-base-227033/',
							].map((link, i) => (
								<Button variant='link' onClick={() => openUrl(link)} key={i} className='h-6'>
									- {link}
								</Button>
							))}
						</AccordionContent>
					</AccordionItem>
					<AccordionItem value='2'>
						<AccordionTrigger>These common provider articles may that help.</AccordionTrigger>
						<AccordionContent className='flex flex-col items-start'>
							{[
								'https://www.xfinity.com/support/articles/xfi-port-forwarding',
								'https://www.spectrum.net/support/internet/advanced-wifi-advanced-settings',
								'https://www.att.com/support/article/u-verse-high-speed-internet/KM1206322/',
								'https://www.verizon.com/support/knowledge-base-227033/',
							].map((link, i) => (
								<Button variant='link' onClick={() => openUrl(link)} key={i} className='h-6'>
									- {link}
								</Button>
							))}
						</AccordionContent>
					</AccordionItem>
				</Accordion>
				<Button className='mt-4 ml-auto' onClick={nextSlide}>
					Continue
				</Button>
			</div>
		</m.div>
	);
}
