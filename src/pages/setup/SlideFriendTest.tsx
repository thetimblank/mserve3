import * as React from 'react';
import { Link } from 'react-router-dom';
import { Circle, CircleCheck, TriangleAlert, Users } from 'lucide-react';

import { SlideFrame, useSlideshow } from '@/components/slideshow';
import { AddressRow } from '@/components/help/help-connection-addresses';
import { Button } from '@/components/ui/button';
import { useServers } from '@/data/servers';
import { useUser } from '@/data/user';
import { usePublicIp } from '@/hooks/use-ip-address';
import { cn } from '@/lib/utils';
import { SetupBullets, SetupCallout } from './setup-callout';
import { DEFAULT_MINECRAFT_PORT } from './setup-steps';
import { useSetup } from './SetupContext';
import { FRIEND_TEST_FALSE_RESULTS, FRIEND_TEST_RESULTS } from './friend-test-results';

type TestOutcome = 'testing' | 'worked' | 'failed';

const ResultsTable: React.FC = () => (
	<div className='w-full overflow-hidden rounded-xl border text-sm'>
		<table className='w-full text-left'>
			<thead className='bg-secondary/50 text-xs text-muted-foreground'>
				<tr>
					<th className='px-3 py-2 font-medium'>Your friend sees</th>
					<th className='px-3 py-2 font-medium'>What it means</th>
				</tr>
			</thead>
			<tbody>
				{FRIEND_TEST_RESULTS.map((result) => (
					<tr key={result.sees} className='border-t align-top'>
						<td className='w-2/5 px-3 py-2 font-medium'>{result.sees}</td>
						<td className='px-3 py-2'>
							<p className={cn('font-medium', result.networkWorks && 'text-green-600 dark:text-green-400')}>
								{result.means}
							</p>
							<p className='text-muted-foreground'>{result.next}</p>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	</div>
);

export default function SlideFriendTest() {
	const { prevSlide } = useSlideshow();
	const { data, choosePath } = useSetup();
	const { servers } = useServers();
	const { updateUserField } = useUser();
	const publicIp = usePublicIp();
	const [outcome, setOutcome] = React.useState<TestOutcome>('testing');
	const hasOnlineServer = servers.some((server) => server.status === 'online');
	const portSuffix = data.port !== DEFAULT_MINECRAFT_PORT ? `:${data.port}` : '';
	const address = typeof publicIp === 'string' ? `${publicIp}${portSuffix}` : publicIp;

	const handleWorked = () => {
		updateUserField('initial_setup_hosting_tutorial_completed', true);
		updateUserField('completed_setup_hosting_ports', (ports) =>
			ports.includes(data.port) ? ports : [...ports, data.port],
		);
		setOutcome('worked');
	};

	if (outcome === 'worked') {
		return (
			<SlideFrame className='flex flex-col items-center text-center'>
				<CircleCheck className='mb-6 size-20 text-green-500' />
				<h1 className='mb-2 text-3xl font-bold'>You&apos;re ready</h1>
				<p className='mb-10'>Players outside your network can join your server.</p>
				<Button asChild>
					<Link to='/'>Back Home</Link>
				</Button>
			</SlideFrame>
		);
	}

	if (outcome === 'failed') {
		return (
			<SlideFrame className='flex w-full max-w-2xl flex-col items-center'>
				<TriangleAlert className='mb-6 size-16 text-amber-500' />
				<h1 className='mb-2 text-center text-3xl font-bold'>What did your friend see?</h1>
				<p className='mb-8 text-center text-muted-foreground'>
					The message on their screen tells you where it got stuck.
				</p>
				<div className='flex w-full flex-col items-start gap-4'>
					<ResultsTable />
					<SetupCallout icon={TriangleAlert} tone='warning' title='Common false results'>
						<SetupBullets items={[...FRIEND_TEST_FALSE_RESULTS]} />
					</SetupCallout>
					<div className='ml-auto flex flex-wrap justify-end gap-2'>
						<Button variant='secondary' onClick={() => setOutcome('testing')}>
							Test again
						</Button>
						<Button variant='secondary' onClick={() => choosePath('tunnel')}>
							Switch to tunnel
						</Button>
					</div>
				</div>
			</SlideFrame>
		);
	}

	return (
		<SlideFrame className='flex w-full max-w-xl flex-col items-center'>
			<Users className='mb-6 size-16' />
			<h1 className='mb-2 text-center text-3xl font-bold'>Test with a friend</h1>
			<p className='mb-8 text-center text-muted-foreground'>
				The only sure check is someone outside your home network joining.
			</p>

			<div className='flex w-full flex-col items-start gap-4'>
				<ol className='w-full space-y-3'>
					<li className='flex gap-3'>
						{hasOnlineServer ? (
							<CircleCheck className='mt-0.5 size-5 shrink-0 text-green-500' />
						) : (
							<Circle className='mt-0.5 size-5 shrink-0 text-amber-500' />
						)}
						<div>
							<p className='font-medium'>Your server shows Online in mserve</p>
							{!hasOnlineServer && (
								<p className='text-sm text-muted-foreground'>
									No server is online yet.{' '}
									<Button variant='link' className='h-auto p-0' onClick={prevSlide}>
										Start one
									</Button>
								</p>
							)}
						</div>
					</li>
					<li className='flex gap-3'>
						<Circle className='mt-0.5 size-5 shrink-0 text-muted-foreground' />
						<div>
							<p className='font-medium'>Your friend is on a different network</p>
							<p className='text-sm text-muted-foreground'>
								Not your Wi-Fi. Their phone&apos;s hotspot is fine.
							</p>
						</div>
					</li>
					<li className='flex gap-3'>
						<Circle className='mt-0.5 size-5 shrink-0 text-muted-foreground' />
						<div className='w-full space-y-2'>
							<p className='font-medium'>They add this address in Multiplayer</p>
							<AddressRow label='Public' value={address} />
							<p className='text-sm text-muted-foreground'>
								Wait about 30 seconds, then press Refresh. If the server shows up with its MOTD and ping
								bars, it works.
							</p>
						</div>
					</li>
				</ol>

				<div className='ml-auto flex gap-2'>
					<Button variant='secondary' onClick={() => setOutcome('failed')}>
						It didn&apos;t work
					</Button>
					<Button onClick={handleWorked}>It worked</Button>
				</div>
			</div>
		</SlideFrame>
	);
}
