import React from 'react';
import { Clipboard, ClipboardCheck, Loader2, OctagonAlert, Router } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SettingsRow, SettingsRows } from '@/components/settings/settings-row';
import type { Server } from '@/data/servers';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

import { useServerUpnp, type ServerUpnp } from './hooks/use-server-upnp';

/** The live state of an enabled router forward: the public address, progress, or the error. */
const UpnpStatusDetails: React.FC<{ upnp: ServerUpnp }> = ({ upnp }) => {
	const { copied, copy } = useCopyToClipboard();

	if (upnp.status === 'active' && upnp.address) {
		const address = upnp.address;
		return (
			<div className='flex items-center gap-2 rounded-md border-2 bg-card px-3 py-1.5 text-sm dark:border-none dark:bg-secondary/50'>
				<Router className='size-4 shrink-0 text-emerald-500' />
				<p className='text-muted-foreground select-none'>Forwarded. Players join at:</p>
				<span className='font-mono text-emerald-500'>{address}</span>
				<Button
					variant='ghost'
					size='sm'
					aria-label={copied ? 'Copied address' : 'Copy address'}
					className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
					onClick={() => copy(address)}>
					{copied ? <ClipboardCheck className='size-3.5' /> : <Clipboard className='size-3.5' />}
				</Button>
			</div>
		);
	}
	if (upnp.status === 'starting') {
		return (
			<div className='flex items-center gap-2 text-sm text-muted-foreground'>
				<Loader2 className='size-4 animate-spin' />
				<span>Asking your router to forward the port...</span>
			</div>
		);
	}
	if (upnp.status === 'error') {
		return (
			<p className='flex items-start gap-2 text-sm text-destructive'>
				<OctagonAlert className='mt-0.5 size-4 shrink-0' />
				{upnp.error ?? 'Your router did not forward the port.'}
			</p>
		);
	}
	return (
		<p className='text-sm text-muted-foreground'>
			The port is forwarded when the server starts and removed when it stops.
		</p>
	);
};

export const UpnpSettingsSection: React.FC<{ server: Server }> = ({ server }) => {
	const upnp = useServerUpnp(server.directory);

	return (
		<SettingsRows>
			<SettingsRow
				title='Forward the port automatically (UPnP)'
				htmlFor='upnp-enabled'
				description="Ask your router to forward this server's port while it runs, so friends can join with your public IP. Needs UPnP turned on in the router, and doesn't work behind CGNAT."
				control={
					<Checkbox
						id='upnp-enabled'
						checked={upnp.enabled}
						disabled={upnp.busy}
						onCheckedChange={(checked) => upnp.setEnabled(checked === true)}
					/>
				}>
				{upnp.enabled && <UpnpStatusDetails upnp={upnp} />}
			</SettingsRow>
		</SettingsRows>
	);
};
