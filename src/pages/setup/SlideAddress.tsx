import { SlideFrame, useSlideshow } from '@/components/slideshow';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useSetup } from './SetupContext';
import { Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { useLocalIp, usePublicIp } from '@/hooks/use-ip-address';
import { SetupBullets, SetupCallout } from './setup-callout';
import { DEFAULT_MINECRAFT_PORT } from './setup-steps';

export default function SlideAddress() {
	const { nextSlide } = useSlideshow();
	const { data, updateData, choosePath } = useSetup();
	const publicIp = usePublicIp();
	const localIp = useLocalIp();
	const ipText = publicIp === null ? 'Loading…' : publicIp === false ? 'Unavailable' : publicIp;
	const portSuffix = data.port !== DEFAULT_MINECRAFT_PORT ? `:${data.port}` : '';

	return (
		<SlideFrame className='flex w-full max-w-2xl flex-col items-center text-center'>
			<h1 className='text-3xl font-bold mb-2'>Get your server address</h1>
			<p className='mb-10 text-muted-foreground'>
				This is the address you share with other players so they can connect.
			</p>
			<div className='flex w-full flex-col items-start gap-4 text-start'>
				<div className='w-full space-y-1'>
					<p className='flex items-center gap-2'>
						Your public IPv4 address:{' '}
						<span className='font-mono font-semibold'>
							{data.ip_hidden ? <span className='blur-xs select-none'>XXX.XXX.X.X</span> : ipText}
							{portSuffix}
						</span>
						<Button
							variant='ghost'
							size='sm'
							aria-label={data.ip_hidden ? 'Show address' : 'Hide address'}
							onClick={() => updateData('ip_hidden', !data.ip_hidden)}>
							{data.ip_hidden ? <Eye /> : <EyeOff />}
						</Button>
					</p>
					{typeof localIp === 'string' && (
						<p className='text-sm text-muted-foreground'>
							Players on your Wi-Fi use{' '}
							<span className='font-mono'>
								{localIp}
								{portSuffix}
							</span>{' '}
							instead.
						</p>
					)}
				</div>

				<SetupCallout icon={ShieldAlert} tone='warning' title='Share it with people you trust'>
					<SetupBullets
						items={[
							'An IP shows a rough location (city or internet provider), not your exact address.',
							'The real risk is someone flooding your connection (a DDoS attack).',
							"A tunnel hides your IP if you'd rather not share it.",
						]}
					/>
					<Button variant='link' size='sm' className='h-auto px-0' onClick={() => choosePath('tunnel')}>
						Set up a tunnel instead
					</Button>
				</SetupCallout>

				<Accordion type='single' collapsible className='w-full'>
					<AccordionItem value='domain'>
						<AccordionTrigger>Have a custom domain?</AccordionTrigger>
						<AccordionContent className='flex flex-col items-start'>
							{[
								<>Log into your domain provider (GoDaddy, Cloudflare, etc.)</>,
								<>Set up an A record pointing to your public IP</>,
								<>Set up an SRV record if your server doesn&apos;t use port 25565</>,
								<>
									Save, then wait for the record&apos;s TTL to pass (a few minutes up to 24 hours)
								</>,
								<>
									For more help, look up how to connect a custom domain to a Minecraft server.
								</>,
							].map((step, i) => (
								<p key={i} className='mb-1'>
									{i + 1}. {step}
								</p>
							))}
						</AccordionContent>
					</AccordionItem>
					<AccordionItem value='cant-connect'>
						<AccordionTrigger>Players can&apos;t connect?</AccordionTrigger>
						<AccordionContent className='flex flex-col items-start'>
							<SetupBullets
								items={[
									'Check that the server is online',
									"Check the port forward on your router (TCP, pointing at this PC's local IP)",
									'Check that the firewall on this PC allows the port',
									'Check that you can connect with "localhost" on this PC',
									'Check your custom domain, if you use one',
									'Behind CGNAT, forwarding cannot work: use the tunnel',
								]}
							/>
						</AccordionContent>
					</AccordionItem>
				</Accordion>
				<Button className='ml-auto' onClick={nextSlide}>
					Continue
				</Button>
			</div>
		</SlideFrame>
	);
}
