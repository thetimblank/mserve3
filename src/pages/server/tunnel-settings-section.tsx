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

import { useServerTunnel } from './hooks/use-server-tunnel';

export const TunnelSettingsSection: React.FC<{ server: Server }> = ({ server }) => {
	const account = usePlayitAccount();
	const tunnel = useServerTunnel(server.directory);
	const { copied, copy: copyAddress } = useCopyToClipboard();

	const displayAddress = tunnel.address;

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
							<div className='space-y-3'>
								{tunnel.status === 'online' && displayAddress ? (
									<div className='flex items-center gap-2 rounded-md border-2 bg-card px-3 py-1.5 text-sm dark:border-none dark:bg-secondary/50'>
										<Globe className='size-4 shrink-0 text-emerald-500' />
										<p className='text-muted-foreground select-none'>Public address:</p>
										<span className='font-mono text-emerald-500'>{displayAddress}</span>
										<Button
											variant='ghost'
											size='sm'
											className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
											onClick={() => copyAddress(displayAddress)}>
											{copied ? (
												<ClipboardCheck className='size-3.5' />
											) : (
												<Clipboard className='size-3.5' />
											)}
										</Button>
									</div>
								) : tunnel.status === 'starting' ? (
									<div className='flex items-center gap-2 text-sm text-muted-foreground'>
										<Loader2 className='size-4 animate-spin' />
										<span>Starting tunnel...</span>
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
												Last address:{' '}
												<span className='font-mono text-sky-500'>{displayAddress}</span>
											</p>
										)}
									</div>
								)}
							</div>
						)}
					</SettingsRow>
				</SettingsRows>
			)}
		</>
	);
};
