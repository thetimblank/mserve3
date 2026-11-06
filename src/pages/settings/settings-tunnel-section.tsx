import * as React from 'react';
import { CircleCheck, Loader2, OctagonAlert, Plug, Unplug } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';

import { SettingsRow, SettingsRows } from '@/components/settings/settings-row';
import { Button } from '@/components/ui/button';
import { usePlayitAccount, type PlayitAccount } from '@/hooks/use-playit-account';

/**
 * Where the playit.gg account stands: loading, connected, waiting for browser
 * approval (with a reopen link), or the claim error. Shared by global Settings
 * and the hosting setup's tunnel branch.
 */
export const PlayitAccountStatus: React.FC<{ account: PlayitAccount }> = ({ account }) => {
	if (account.claimed === null) {
		return (
			<div className='flex items-center gap-2 text-sm text-muted-foreground'>
				<Loader2 className='size-4 animate-spin' />
				<span>Loading account status...</span>
			</div>
		);
	}
	if (account.claimed) {
		return (
			<p className='flex items-center gap-2 text-sm'>
				<CircleCheck className='size-4 shrink-0 text-emerald-500' />
				<span>Connected.</span>
			</p>
		);
	}
	if (account.claimState.status === 'pending') {
		return (
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
		);
	}
	if (account.claimState.status === 'error' && account.claimState.error) {
		return (
			<p className='flex items-center gap-2 text-sm text-destructive'>
				<OctagonAlert className='size-4 shrink-0' />
				{account.claimState.error}
			</p>
		);
	}
	return null;
};

const SettingsTunnelSection: React.FC = () => {
	const account = usePlayitAccount();

	const renderControl = () => {
		if (account.claimed === null) return null;
		if (account.claimed) {
			return (
				<Button variant='secondary' size='sm' onClick={account.disconnectAccount} disabled={account.busy}>
					<Unplug className='size-4' />
					<span>Disconnect</span>
				</Button>
			);
		}
		if (account.claimState.status === 'pending') return null;
		return (
			<Button onClick={account.connectAccount} disabled={account.busy}>
				<Plug className='size-4' />
				<span>Connect</span>
			</Button>
		);
	};

	return (
		<SettingsRows>
			<SettingsRow
				title='playit.gg account'
				description='Connect once for this install. Tunneling is then turned on per server in its settings.'
				control={renderControl()}>
				<PlayitAccountStatus account={account} />
			</SettingsRow>
		</SettingsRows>
	);
};

export default SettingsTunnelSection;
