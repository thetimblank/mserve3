import React from 'react';
import {
	Clipboard,
	ClipboardCheck,
	Globe,
	Loader2,
	OctagonAlert,
	Plug,
	Unplug,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Container } from '@/components/ui/container';
import type { Server } from '@/data/servers';

import { useServerTunnel } from './hooks/use-server-tunnel';

export const TunnelSettingsSection: React.FC<{ server: Server }> = ({ server }) => {
	const tunnel = useServerTunnel(server.directory);
	const [copied, setCopied] = React.useState(false);

	const copyAddress = React.useCallback((text: string) => {
		navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}, []);

	const displayAddress = tunnel.address ?? server.tunnel_address ?? null;

	return (
		<div className='max-w-2xl space-y-8'>
			<div className='space-y-1'>
				<p className='text-xl'>Tunnel</p>
				<p className='text-sm text-muted-foreground'>
					Make this server reachable from anywhere over the internet — no port forwarding — using a
					free, persistent <span className='font-medium'>playit.gg</span> address.
				</p>
			</div>

			{tunnel.claimed === null ? (
				<div className='flex items-center gap-2 text-sm text-muted-foreground'>
					<Loader2 className='size-4 animate-spin' />
					<span>Loading tunnel status...</span>
				</div>
			) : !tunnel.claimed ? (
				<Container className='space-y-4'>
					<div className='space-y-1'>
						<p className='font-semibold'>Connect a playit.gg account</p>
						<p className='text-sm text-muted-foreground'>
							Tunneling needs a free playit.gg account. Connect one once for this install; every
							server can then get its own tunnel.
						</p>
					</div>

					{tunnel.claimState.status === 'pending' ? (
						<div className='space-y-2'>
							<div className='flex items-center gap-2 text-sm text-muted-foreground'>
								<Loader2 className='size-4 animate-spin' />
								<span>Waiting for you to approve the connection in your browser...</span>
							</div>
							{tunnel.claimState.claimUrl && (
								<Button
									variant='link'
									className='h-auto px-0'
									onClick={() => openUrl(tunnel.claimState.claimUrl!)}>
									Reopen approval page
								</Button>
							)}
						</div>
					) : (
						<Button onClick={tunnel.connectAccount} disabled={tunnel.busy}>
							<Plug className='size-4' />
							<span>Connect playit.gg account</span>
						</Button>
					)}

					{tunnel.claimState.status === 'error' && tunnel.claimState.error && (
						<p className='flex items-center gap-2 text-sm text-destructive'>
							<OctagonAlert className='size-4 shrink-0' />
							{tunnel.claimState.error}
						</p>
					)}
				</Container>
			) : (
				<div className='space-y-6'>
					<Label className='flex max-w-lg items-center gap-3'>
						<Checkbox
							checked={tunnel.enabled}
							disabled={tunnel.busy}
							onCheckedChange={(checked) => tunnel.setEnabled(checked === true)}
						/>
						Enable public tunneling for this server
					</Label>

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

					<Button
						variant='ghost'
						size='sm'
						className='text-muted-foreground'
						onClick={tunnel.disconnectAccount}
						disabled={tunnel.busy}>
						<Unplug className='size-4' />
						<span>Disconnect playit.gg account</span>
					</Button>
				</div>
			)}
		</div>
	);
};
