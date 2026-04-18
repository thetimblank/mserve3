import { m } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useSetup } from './SetupContext';
import { Eye, EyeOff } from 'lucide-react';

export default function Slide3() {
	const { data, updated_ata, nextSlide } = useSetup();

	return (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='flex flex-col items-center text-center'>
			<p className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>Get your server IP</p>
			<p className='mb-20'>This is the address you will share with other players so they can connect.</p>
			<div className='flex flex-col items-start text-start'>
				<p className='mb-4 flex gap-2 items-center'>
					Your server IP is:{' '}
					{data.ip_hidden ? <span className='blur-xs select-none'>XXX.XXX.X.X</span> : data.ip}
					{data.port !== 25565 && ':' + data.port}
					<Button variant='ghost' onClick={() => updated_ata('ip_hidden', !data.ip_hidden)}>
						{data.ip_hidden ? <Eye /> : <EyeOff />}
					</Button>
				</p>
				<Accordion type='single' collapsible className='w-[50vw]'>
					<AccordionItem value='1'>
						<AccordionTrigger>Have a custom domain?</AccordionTrigger>
						<AccordionContent className='flex flex-col items-start'>
							{[
								<>Log into your domain provider (Godaddy, Cloudflare, etc)</>,
								<>Setup an A record</>,
								<>Setup a SRV record</>,
								<>
									Click Save, you will have to wait to the amount the TTL is set to. (1 hour, a
									couple minutes, 24 hours, etc)
								</>,
								<>
									If you need more help with this, look up how to connect a custom domain to your
									minecraft server on YouTube, Google, AI, or other places.
								</>,
							].map((step, i) => (
								<p key={i} className='mb-1'>
									{i + 1}. {step}
								</p>
							))}
						</AccordionContent>
					</AccordionItem>
					<AccordionItem value='2'>
						<AccordionTrigger>Is this a security issue?</AccordionTrigger>
						<AccordionContent>
							<p>
								It can be. Trust whoever you give this IP to. People will be able to generalize or
								pinpoint your location. This also opens a risk of DDoS attacks on your network. <br />
								However, as long as you aren&apos;t careless and you have good friends, you should
								usually be fine.
							</p>
						</AccordionContent>
					</AccordionItem>
					<AccordionItem value='3'>
						<AccordionTrigger>Players can&apos;t connect?</AccordionTrigger>
						<AccordionContent className='flex flex-col items-start'>
							{[
								'Check if you correctly setup port forwarding on your PC',
								'Check if you correctly setup port forwarding on your Network',
								'Check if your server is online',
								'Check if you can connect with "localhost" or "127.0.0.1" on your own PC',
								"Check if you correctly setup your custom domain if you're using one",
								`Check if others can successfully "ping" your IP ${data.ip_hidden ? '' : `(Tell them to type "ping ${data.ip}" in command prompt/terminal)`}`,
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
