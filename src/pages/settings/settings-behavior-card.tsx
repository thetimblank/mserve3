import * as React from 'react';
import { Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useUser } from '@/data/user';

const SettingsBehaviorCard: React.FC = () => {
	const { user, updateUserField } = useUser();

	const handleSuppressCloseWarningChange = (checked: boolean | 'indeterminate') => {
		const enabled = checked === true;
		updateUserField('suppress_close_warning', enabled);
		toast.success(enabled ? 'Close warning disabled.' : 'Close warning enabled.');
	};

	const handleAdvancedModeChange = (checked: boolean | 'indeterminate') => {
		const enabled = checked === true;
		updateUserField('advanced_mode', enabled);
		toast.success(`Advanced mode ${enabled ? 'enabled' : 'disabled'}.`);
	};

	const handleAutoCheckServerUpdatesChange = (checked: boolean | 'indeterminate') => {
		const enabled = checked === true;
		updateUserField('auto_check_server_updates', enabled);
		toast.success(`Automatic server update checks ${enabled ? 'enabled' : 'disabled'}.`);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className='flex items-center gap-2'>
					<Settings2 className='w-5 h-5' />
					Behavior
				</CardTitle>
				<CardDescription>Control how the app behaves in certain situations.</CardDescription>
			</CardHeader>
			<CardContent className='space-y-4'>
				<div className='space-y-2'>
					<Label className='flex items-center gap-3'>
						<Checkbox
							checked={user.suppress_close_warning}
							onCheckedChange={handleSuppressCloseWarningChange}
						/>
						Skip close warning when servers are running
					</Label>
					<p className='text-sm text-muted-foreground'>
						When enabled, closing MSERVE with active servers will force shut them down immediately
						without prompting. This may cause data loss.
					</p>
				</div>
				<div className='space-y-2'>
					<Label className='flex items-center gap-3'>
						<Checkbox checked={user.advanced_mode} onCheckedChange={handleAdvancedModeChange} />
						Advanced Mode
					</Label>
					<p className='text-sm text-muted-foreground'>
						Unlocks per-server overrides, sub-gigabyte RAM, and bypasses RAM safety caps.
					</p>
				</div>
				<div className='space-y-2'>
					<Label className='flex items-center gap-3'>
						<Checkbox
							checked={user.auto_check_server_updates}
							onCheckedChange={handleAutoCheckServerUpdatesChange}
						/>
						Check servers for updates on startup
					</Label>
					<p className='text-sm text-muted-foreground'>
						When enabled, MSERVE checks each server's provider for a newer jar build when the app loads and
						flags it in the server's jar settings. No update is ever installed automatically.
					</p>
				</div>
			</CardContent>
		</Card>
	);
};

export default SettingsBehaviorCard;
