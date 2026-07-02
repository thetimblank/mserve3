import * as React from 'react';
import { CircleCheck, Loader2, OctagonAlert, Plug, Unplug } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { usePlayitAccount } from '@/hooks/use-playit-account';

const SettingsTunnelCard: React.FC = () => {
	const account = usePlayitAccount();

	return (
		<Card>
			<CardHeader>
				<CardTitle className='flex items-center gap-2'>
					<Plug className='w-5 h-5' />
					Tunneling
				</CardTitle>
				<CardDescription>
					Connect a free <span className='font-medium'>playit.gg</span> account to expose your servers
					over the internet without port forwarding. Connect once here; enable tunneling per server in
					its settings.
				</CardDescription>
			</CardHeader>
			<CardContent className='space-y-4'>
				{account.claimed === null ? (
					<div className='flex items-center gap-2 text-sm text-muted-foreground'>
						<Loader2 className='size-4 animate-spin' />
						<span>Loading account status...</span>
					</div>
				) : account.claimed ? (
					<div className='space-y-4'>
						<p className='flex items-center gap-2 text-sm'>
							<CircleCheck className='size-4 shrink-0 text-emerald-500' />
							<span>playit.gg account connected.</span>
						</p>
						<Button
							variant='ghost'
							size='sm'
							className='text-muted-foreground'
							onClick={account.disconnectAccount}
							disabled={account.busy}>
							<Unplug className='size-4' />
							<span>Disconnect playit.gg account</span>
						</Button>
					</div>
				) : account.claimState.status === 'pending' ? (
					<div className='space-y-2'>
						<div className='flex items-center gap-2 text-sm text-muted-foreground'>
							<Loader2 className='size-4 animate-spin' />
							<span>Waiting for you to approve the connection in your browser...</span>
						</div>
						{account.claimState.claimUrl && (
							<Button
								variant='link'
								className='h-auto px-0'
								onClick={() => openUrl(account.claimState.claimUrl!)}>
								Reopen approval page
							</Button>
						)}
					</div>
				) : (
					<div className='space-y-3'>
						<Button onClick={account.connectAccount} disabled={account.busy}>
							<Plug className='size-4' />
							<span>Connect playit.gg account</span>
						</Button>
						{account.claimState.status === 'error' && account.claimState.error && (
							<p className='flex items-center gap-2 text-sm text-destructive'>
								<OctagonAlert className='size-4 shrink-0' />
								{account.claimState.error}
							</p>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
};

export default SettingsTunnelCard;
