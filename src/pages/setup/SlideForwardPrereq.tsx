import { Building2, KeyRound, Router, Share2 } from 'lucide-react';

import { SlideFrame, useSlideshow } from '@/components/slideshow';
import { Button } from '@/components/ui/button';
import { AddressRow } from '@/components/help/help-connection-addresses';
import { usePublicIp } from '@/hooks/use-ip-address';
import { SetupBullets, SetupCallout } from './setup-callout';
import { useSetup } from './SetupContext';

export default function SlideForwardPrereq() {
	const { nextSlide } = useSlideshow();
	const { choosePath } = useSetup();
	const publicIp = usePublicIp();

	return (
		<SlideFrame className='flex w-full max-w-xl flex-col items-center text-center'>
			<Router className='mb-6 size-16' />
			<h1 className='mb-2 text-3xl font-bold'>Before you start</h1>
			<p className='mb-8 text-muted-foreground'>
				Port forwarding is a setting on your router, so you need to be able to change it.
			</p>

			<div className='mb-8 w-full space-y-3'>
				<SetupCallout icon={KeyRound} title='You need admin access to your router'>
					<p>
						Either its login page in a browser, or your internet provider&apos;s app. The default login
						is often printed on a sticker on the router.
					</p>
				</SetupCallout>
				<SetupCallout icon={Building2} tone='warning' title="No access? Use the tunnel">
					<p>
						Apartments, dorms, schools, offices and shared Wi-Fi usually don&apos;t let you change the
						router.
					</p>
				</SetupCallout>
				<SetupCallout icon={Share2} tone='warning' title='Behind CGNAT? Use the tunnel'>
					<p>
						Common on 5G and mobile home internet, Starlink, and some fiber plans. Your provider shares
						one public IP between many homes, so a forward on your router never receives players.
					</p>
					<SetupBullets
						items={[
							"How to tell: your router's status page shows a WAN (internet) IP.",
							'If it starts with 100.64 to 100.127, or differs from your public IP below, you are behind CGNAT.',
						]}
					/>
					<div className='pt-1'>
						<AddressRow label='Public' value={publicIp} />
					</div>
				</SetupCallout>
			</div>

			<div className='ml-auto flex gap-2'>
				<Button variant='secondary' onClick={() => choosePath('tunnel')}>
					Use a tunnel instead
				</Button>
				<Button onClick={nextSlide}>I can change my router</Button>
			</div>
		</SlideFrame>
	);
}
