import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CircleCheck, OctagonAlert, Wand2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { getErrorMessage } from '@/lib/utils';
import { SetupCallout } from './setup-callout';
import { useSetup } from './SetupContext';

type CheckState =
	| { kind: 'idle' }
	| { kind: 'checking' }
	| { kind: 'ok'; publicIp: string | null }
	| { kind: 'failed'; error: string };

/**
 * The router slide's automatic option: asks the router (UPnP) to forward the port.
 * On success the guide turns UPnP on for the server it starts, so the manual
 * steps can be skipped.
 */
export const AutomaticForward: React.FC<{ portIsValid: boolean; onDone: () => void }> = ({
	portIsValid,
	onDone,
}) => {
	const { data, updateData, choosePath } = useSetup();
	// Coming back to the slide keeps an earlier success.
	const [check, setCheck] = React.useState<CheckState>(
		data.upnp ? { kind: 'ok', publicIp: null } : { kind: 'idle' },
	);
	const port = data.port;

	// A different port needs a fresh check.
	const checkedPortRef = React.useRef(port);
	React.useEffect(() => {
		if (checkedPortRef.current === port) return;
		checkedPortRef.current = port;
		setCheck({ kind: 'idle' });
		updateData('upnp', false);
	}, [port, updateData]);

	const handleCheck = async () => {
		setCheck({ kind: 'checking' });
		try {
			const publicIp = await invoke<string>('check_upnp', { port });
			setCheck({ kind: 'ok', publicIp });
			updateData('upnp', true);
		} catch (err) {
			setCheck({ kind: 'failed', error: getErrorMessage(err, 'Your router did not forward the port.') });
			updateData('upnp', false);
		}
	};

	if (check.kind === 'ok') {
		return (
			<SetupCallout icon={CircleCheck} title='Your router can forward the port automatically'>
				<p>
					mserve will forward port <span className='font-mono font-semibold'>{port}</span> whenever the
					server you start in this guide is running, and remove it when it stops.
					{check.publicIp && (
						<>
							{' '}
							Your public IP is <span className='font-mono font-semibold'>{check.publicIp}</span>.
						</>
					)}
				</p>
				<div className='flex justify-end pt-1'>
					<Button size='sm' onClick={onDone}>
						Continue
					</Button>
				</div>
			</SetupCallout>
		);
	}

	return (
		<SetupCallout
			icon={check.kind === 'failed' ? OctagonAlert : Wand2}
			tone={check.kind === 'failed' ? 'warning' : 'info'}
			title={check.kind === 'failed' ? "Automatic forwarding didn't work" : 'Try automatic forwarding first'}>
			{check.kind === 'failed' ? (
				<p>{check.error} You can still forward the port by hand below.</p>
			) : (
				<p>
					Many routers let apps forward a port on request (UPnP). If yours does, you can skip the manual
					steps below.
				</p>
			)}
			<div className='flex flex-wrap justify-end gap-2 pt-1'>
				{check.kind === 'failed' && (
					<Button size='sm' variant='ghost' onClick={() => choosePath('tunnel')}>
						Use a tunnel instead
					</Button>
				)}
				<Button
					size='sm'
					variant='secondary'
					onClick={handleCheck}
					disabled={!portIsValid || check.kind === 'checking'}>
					{check.kind === 'checking' && <Spinner />}
					{check.kind === 'failed' ? 'Try again' : `Forward port ${port} automatically`}
				</Button>
			</div>
		</SetupCallout>
	);
};
