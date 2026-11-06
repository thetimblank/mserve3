import { Plug, Waypoints } from 'lucide-react';

import { SlideFrame, useSlideshow } from '@/components/slideshow';
import { Button } from '@/components/ui/button';
import { usePlayitAccount } from '@/hooks/use-playit-account';
import { PlayitAccountStatus } from '@/pages/settings/settings-tunnel-section';
import { SetupBullets } from './setup-callout';

export default function SlideTunnelAccount() {
	const { nextSlide } = useSlideshow();
	const account = usePlayitAccount();
	const isWaiting = account.claimState.status === 'pending';

	return (
		<SlideFrame className='flex w-full max-w-lg flex-col items-center text-center'>
			<Waypoints className='mb-6 size-16' />
			<h1 className='mb-2 text-3xl font-bold'>Connect playit.gg</h1>
			<p className='mb-8 text-muted-foreground'>
				The tunnel runs through playit.gg, a free service. You connect an account once for this install.
			</p>

			<div className='mb-8 w-full space-y-4 rounded-2xl bg-secondary/50 p-5 text-left text-sm'>
				<SetupBullets
					items={[
						'mserve opens playit.gg in your browser.',
						'Sign up or log in, then approve the connection.',
						'Come back here: it connects on its own.',
					]}
				/>
				<PlayitAccountStatus account={account} />
			</div>

			<div className='ml-auto flex gap-2'>
				{account.claimed ? (
					<Button onClick={nextSlide}>Continue</Button>
				) : (
					account.claimed === false && (
						<Button onClick={account.connectAccount} disabled={account.busy || isWaiting}>
							<Plug className='size-4' />
							Connect playit.gg
						</Button>
					)
				)}
			</div>
		</SlideFrame>
	);
}
