import React from 'react';
import { Link } from 'react-router-dom';
import { Clipboard, ClipboardCheck, Globe, Loader2, OctagonAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Container } from '@/components/ui/container';
import { SettingsRow, SettingsRows } from '@/components/settings/settings-row';
import { usePlayitAccount } from '@/hooks/use-playit-account';
import type { Server } from '@/data/servers';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

import { useServerTunnel, type ServerTunnel } from './hooks/use-server-tunnel';

/**
 * The live state of an enabled tunnel: the public address (copyable) once it is
 * online, or starting/error/idle feedback. Shared by the server's Tunnel settings
 * and the hosting setup's tunnel branch.
 */
export const TunnelStatusDetails: React.FC<{
	tunnel: ServerTunnel;
	/** The server is up, so an idle tunnel is about to start (the backend starts it on enable). */
	serverOnline?: boolean;
}> = ({ tunnel, serverOnline = false }) => {
	const { copied, copy: copyAddress } = useCopyToClipboard();
	const displayAddress = tunnel.address;
	const isStarting = tunnel.status === 'starting' || (serverOnline && tunnel.status === 'offline');

	return (
		<div className='space-y-3'>
			{tunnel.status === 'online' && displayAddress ? (
				<div className='flex items-center gap-2 rounded-md border-2 bg-card px-3 py-1.5 text-sm dark:border-none dark:bg-secondary/50'>
					<Globe className='size-4 shrink-0 text-emerald-500' />
					<p className='text-muted-foreground select-none'>Public address:</p>
					<span className='font-mono text-emerald-500'>{displayAddress}</span>
					<Button
						variant='ghost'
						size='sm'
						aria-label={copied ? 'Copied address' : 'Copy address'}
						className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
						onClick={() => copyAddress(displayAddress)}>
						{copied ? <ClipboardCheck className='size-3.5' /> : <Clipboard className='size-3.5' />}
					</Button>
				</div>
			) : isStarting ? (
				<div className='space-y-1 text-sm text-muted-foreground'>
					<div className='flex items-center gap-2'>
						<Loader2 className='size-4 animate-spin' />
						<span>Starting tunnel...</span>
					</div>
					{tunnel.message && (
						<p className='pl-6'>
							playit: {tunnel.message.replace(/[.\s]+$/, '')}. A new tunnel can take a minute or two.
						</p>
					)}
				</div>
			) : tunnel.status === 'error' ? (
				<p className='flex items-center gap-2 text-sm text-destructive'>
					<OctagonAlert className='size-4 shrink-0' />
					{tunnel.error ?? 'The tunnel failed to start.'}
				</p>
			) : (
				<div className='space-y-1 text-sm text-muted-foreground'>
					<p>The tunnel starts automatically when the server starts.</p>
					{displayAddress && (
						<p>
							Last address: <span className='font-mono text-sky-500'>{displayAddress}</span>
						</p>
					)}
				</div>
			)}
		</div>
	);
};

export const TunnelSettingsSection: React.FC<{ server: Server }> = ({ server }) => {
	const account = usePlayitAccount();
	const tunnel = useServerTunnel(server.directory);

	return (
		<>
			{account.claimed === null ? (
				<div className='flex items-center gap-2 text-sm text-muted-foreground'>
					<Loader2 className='size-4 animate-spin' />
					<span>Loading tunnel status...</span>
				</div>
			) : !account.claimed ? (
				<Container className='space-y-3'>
					<div className='space-y-1'>
						<p className='font-semibold'>Connect a playit.gg account</p>
						<p className='text-sm text-muted-foreground'>
							Tunneling needs a free playit.gg account, connected once for this install. Set it up in{' '}
							<Link to='/settings#tunnel' className='font-medium text-foreground underline underline-offset-4'>
								Settings
							</Link>
							, then enable tunneling here.
						</p>
					</div>
				</Container>
			) : (
				<SettingsRows>
					<SettingsRow
						title='Public tunneling'
						htmlFor='tunnel-enabled'
						description='Give this server a public playit.gg address that friends can join from anywhere.'
						control={
							<Checkbox
								id='tunnel-enabled'
								checked={tunnel.enabled}
								disabled={tunnel.busy}
								onCheckedChange={(checked) => tunnel.setEnabled(checked === true)}
							/>
						}>
						{tunnel.enabled && (
							<TunnelStatusDetails tunnel={tunnel} serverOnline={server.status === 'online'} />
						)}
					</SettingsRow>
				</SettingsRows>
			)}
		</>
	);
};
