import { m } from 'motion/react';
import { Button } from '@/components/ui/button';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { SquareArrowOutUpRight } from 'lucide-react';
import { useSetup } from './SetupContext';

export default function Slide2() {
	const { nextSlide, data } = useSetup();

	return (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='flex flex-col items-center'>
			<p className='text-3xl text-center font-bold flex gap-5 items-center mb-2 w-fit'>
				Setup Port Forwarding on your Network
			</p>
			<p className='mb-20 text-center'>
				This will allow your server to be seen by other players. (Part 2/2)
			</p>
			<div className='flex flex-col items-start'>
				<p className='mb-4'>
					You may have to enable port forwarding on your network. <br /> Please login to your network
					dashboard and forward {data.port}.
					<br />{' '}
					<span className='text-sm text-muted-foreground'>Dont worry, this is the hardest step.</span>
				</p>
				<Accordion type='single' collapsible className='w-[50vw]'>
					<AccordionItem value='1'>
						<AccordionTrigger>Common flow to setup Port Forwarding</AccordionTrigger>
						<AccordionContent className='flex flex-col items-start'>
							{[
								<>Find your network provider</>,
								<>
									Locate the network panel (usually an app or located at{' '}
									<span
										className='hover:underline cursor-pointer font-semibold inline-flex items-center gap-1'
										onClick={() => openUrl('http://192.168.0.1')}>
										http://192.168.0.1
										<SquareArrowOutUpRight className='size-3' />
									</span>{' '}
									or{' '}
									<span
										className='hover:underline cursor-pointer font-semibold inline-flex items-center gap-1'
										onClick={() => openUrl('http://10.0.0.1')}>
										http://10.0.0.1
										<SquareArrowOutUpRight className='size-3' />
									</span>
									)
								</>,
								<>
									Log into into the dashboard. (For website panels: you can usually lookup the
									default login details, or look on the bottom of your router)
								</>,
								<>Find an advanced menu or portforwarding menu</>,
								<>Add a port forward (Sometimes you may have to select your device)</>,
								<>
									Enter 25565 (You may have to select UDP/TCP. You may also have to select
									Inbound/Outbound. Select both on these choices)
								</>,
								<>If required to, click save (You may have to restart your router)</>,
							].map((step, i) => (
								<p key={i} className='mb-1'>
									{i + 1}. {step}
								</p>
							))}
						</AccordionContent>
					</AccordionItem>
					<AccordionItem value='2'>
						<AccordionTrigger>Common provider specific help articles</AccordionTrigger>
						<AccordionContent className='flex flex-col items-start'>
							{[
								'https://www.xfinity.com/support/articles/xfi-port-forwarding',
								'https://www.spectrum.net/support/internet/advanced-wifi-advanced-settings',
								'https://www.att.com/support/article/u-verse-high-speed-internet/KM1206322/',
								'https://www.verizon.com/support/knowledge-base-227033/',
							].map((link, i) => (
								<Button variant='link' onClick={() => openUrl(link)} key={i} className='h-6 px-0'>
									- {link} <SquareArrowOutUpRight className='size-3' />
								</Button>
							))}
						</AccordionContent>
					</AccordionItem>
					<AccordionItem value='3'>
						<AccordionTrigger>
							What if I do not manage/own the network? (Apartment Wifi, etc)
						</AccordionTrigger>
						<AccordionContent className='flex flex-col items-start'>
							{[
								'This step may be skipped as sometimes port forwarding works out of the box.',
								'You may have access to another panel that your apartment/building gives you, check this.',
								'You can contact your network administrator',
								'Otherwise, you can consult an AI or Google for further assistance. Note, unfortunately you may not always be able to port forward due lack of permission.',
							].map((item, i) => (
								<p key={i}>- {item}</p>
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
