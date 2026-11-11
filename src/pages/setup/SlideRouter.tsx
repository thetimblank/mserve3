import * as React from 'react';
import { SlideFrame, useSlideshow } from '@/components/slideshow';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Clipboard, ClipboardCheck, Globe, Pin, Router, Smartphone, SquareArrowOutUpRight } from 'lucide-react';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { type IpAddressValue, useDefaultGateway, useLocalIp } from '@/hooks/use-ip-address';
import { AppMock, WebsitePanelMock } from './router-mock-forms';
import { AutomaticForward } from './automatic-forward';
import { SetupBullets, SetupCallout } from './setup-callout';
import { isValidPort } from './setup-steps';
import { useSetup } from './SetupContext';

type RouterGuide = 'website' | 'app';

const GUIDE_OPTIONS: SegmentedControlOption<RouterGuide>[] = [
	{ value: 'website', label: 'Website panel', icon: Globe },
	{ value: 'app', label: 'App', icon: Smartphone },
];

/** Routers that don't report a gateway are usually at one of these. */
const COMMON_ROUTER_ADDRESSES = ['192.168.0.1', '10.0.0.1'];

const RouterLink: React.FC<{ url: string }> = ({ url }) => (
	<Button variant='link' className='h-auto gap-1 px-0 font-semibold' onClick={() => openUrl(url)}>
		{url}
		<SquareArrowOutUpRight className='size-3' />
	</Button>
);

/** Where the router's admin page probably is: the detected gateway, or the common guesses. */
const RouterAddress: React.FC<{ gateway: IpAddressValue }> = ({ gateway }) => (
	<div className='flex w-full items-center gap-3 rounded-xl bg-secondary/50 px-3 py-2 text-sm'>
		<Router className='size-4 shrink-0 text-muted-foreground' />
		{gateway === null ? (
			<span className='text-muted-foreground'>Looking for your router…</span>
		) : typeof gateway === 'string' ? (
			<>
				<span className='flex-1'>
					Your router is probably at <span className='font-mono font-semibold'>{gateway}</span>
				</span>
				<Button size='sm' variant='secondary' onClick={() => openUrl(`http://${gateway}`)}>
					Open
					<SquareArrowOutUpRight className='size-3' />
				</Button>
			</>
		) : (
			<span className='flex-1'>
				Couldn&apos;t find your router. Its page is often at{' '}
				{COMMON_ROUTER_ADDRESSES.map((address, i) => (
					<React.Fragment key={address}>
						{i > 0 && ' or '}
						<RouterLink url={`http://${address}`} />
					</React.Fragment>
				))}
				.
			</span>
		)}
	</div>
);

export default function SlideRouter() {
	const { nextSlide } = useSlideshow();
	const { data, updateData, choosePath } = useSetup();
	const localIp = useLocalIp();
	const { copied, copy } = useCopyToClipboard();
	const portIsValid = isValidPort(data.port);
	const gateway = useDefaultGateway();
	const [guide, setGuide] = React.useState<RouterGuide>('website');
	const localIpText = typeof localIp === 'string' ? localIp : "this PC's local IP";
	const gatewayText = typeof gateway === 'string' ? gateway : undefined;

	return (
		<SlideFrame className='flex w-full max-w-2xl flex-col items-center'>
			<h1 className='text-3xl text-center font-bold mb-2'>Forward the port on your router</h1>
			<p className='mb-10 text-center text-muted-foreground'>
				This sends players from the internet to this PC. (Part 1 of 2, the hardest step)
			</p>

			<div className='flex w-full flex-col items-start gap-6'>
				<div className='grid w-full gap-4 sm:grid-cols-2'>
					<Field className='flex flex-col gap-1'>
						<Label htmlFor='server-port'>Port</Label>
						<Input
							id='server-port'
							type='number'
							min={1}
							max={65535}
							value={data.port}
							onChange={(event) => updateData('port', Number(event.currentTarget.value))}
						/>
						<p className='text-xs text-muted-foreground'>
							25565 unless your server uses another port.
						</p>
						{!portIsValid && <p className='text-sm text-destructive'>Port must be between 1 and 65535.</p>}
					</Field>
					<div className='flex flex-col gap-1'>
						<Label>Forward to (this PC&apos;s local IP)</Label>
						<div className='flex h-9 items-center gap-2 rounded-md bg-secondary/50 px-3 text-sm'>
							<span className='flex-1 truncate font-mono'>
								{localIp === null ? 'Loading…' : localIp === false ? 'Unavailable' : localIp}
							</span>
							<Button
								variant='ghost'
								size='sm'
								aria-label={copied ? 'Copied local IP' : 'Copy local IP'}
								className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
								disabled={typeof localIp !== 'string'}
								onClick={() => copy(localIp)}>
								{copied ? <ClipboardCheck className='size-3.5' /> : <Clipboard className='size-3.5' />}
							</Button>
						</div>
					</div>
				</div>

				<AutomaticForward portIsValid={portIsValid} onDone={nextSlide} />

				<RouterAddress gateway={gateway} />

				<div className='flex w-full flex-col gap-4'>
					<SegmentedControl
						aria-label='How you manage your router'
						value={guide}
						onValueChange={setGuide}
						options={GUIDE_OPTIONS}
						fullWidth
					/>
					{guide === 'website' ? (
						<>
							<ol className='list-decimal space-y-1.5 pl-5'>
								<li>
									Open{' '}
									{typeof gateway === 'string' ? (
										<span className='font-mono font-semibold'>{gateway}</span>
									) : (
										"your router's address"
									)}{' '}
									in a browser.
								</li>
								<li>Log in. The default login is often on a sticker on the router.</li>
								<li>
									Find <span className='font-semibold'>Port Forwarding</span> (sometimes under Advanced,
									NAT, Firewall, or Virtual Server).
								</li>
								<li>
									Add a rule with the values below. If it asks for a port range, put {data.port} in both
									boxes.
								</li>
								<li>Save. Some routers need a restart before the rule works.</li>
							</ol>
							<WebsitePanelMock port={data.port} localIp={localIpText} routerAddress={gatewayText} />
						</>
					) : (
						<>
							<ol className='list-decimal space-y-1.5 pl-5'>
								<li>
									Open the app for your internet or Wi-Fi (Xfinity, Google Home, Eero, Orbi, TP-Link Deco,
									and so on).
								</li>
								<li>
									Find <span className='font-semibold'>Port forwarding</span>. It is usually under
									Network, Advanced settings, or in the settings of a device.
								</li>
								<li>
									Pick this PC from the device list. If you can&apos;t tell which one it is, look for{' '}
									<span className='font-mono font-semibold'>{localIpText}</span>.
								</li>
								<li>Add a forward with the values below, then save.</li>
							</ol>
							<AppMock port={data.port} localIp={localIpText} />
						</>
					)}
				</div>

				<SetupCallout icon={Pin} title="Keep this PC's local IP fixed">
					<p>
						Routers can give this PC a new local IP after a restart, and the forward stops working. In the
						router, look for <span className='font-semibold'>DHCP reservation</span> (also called static
						or reserved IP) and reserve {localIpText} for this PC.
					</p>
				</SetupCallout>

				<Accordion type='single' collapsible className='w-full'>
					<AccordionItem value='providers'>
						<AccordionTrigger>Common provider specific help articles</AccordionTrigger>
						<AccordionContent className='flex flex-col items-start'>
							{[
								'https://www.xfinity.com/support/articles/xfi-port-forwarding',
								'https://www.spectrum.net/support/internet/advanced-wifi-advanced-settings',
								'https://www.att.com/support/article/u-verse-high-speed-internet/KM1206322/',
								'https://www.verizon.com/support/knowledge-base-227033/',
							].map((link) => (
								<Button variant='link' onClick={() => openUrl(link)} key={link} className='h-6 px-0'>
									- {link} <SquareArrowOutUpRight className='size-3' />
								</Button>
							))}
						</AccordionContent>
					</AccordionItem>
					<AccordionItem value='not-my-network'>
						<AccordionTrigger>
							What if I don&apos;t manage the network? (apartment Wi-Fi, dorms, etc.)
						</AccordionTrigger>
						<AccordionContent className='flex flex-col items-start gap-3'>
							<SetupBullets
								items={[
									'Forwarding needs admin access to the router. Without it, players outside the network cannot reach this PC.',
									'Your building may give you its own panel or app. Check for one.',
									'You can ask the network admin, but shared networks rarely allow it.',
									'The tunnel works without router access.',
								]}
							/>
							<Button variant='secondary' size='sm' onClick={() => choosePath('tunnel')}>
								Use a tunnel instead
							</Button>
						</AccordionContent>
					</AccordionItem>
				</Accordion>

				<Button className='ml-auto' onClick={nextSlide} disabled={!portIsValid}>
					Continue
				</Button>
			</div>
		</SlideFrame>
	);
}
