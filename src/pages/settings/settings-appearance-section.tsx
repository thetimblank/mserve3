import * as React from 'react';
import { toast } from 'sonner';
import { ModeToggle } from '@/components/mode-toggle';
import { SettingsRow, SettingsRows } from '@/components/settings/settings-row';
import { Checkbox } from '@/components/ui/checkbox';
import { useUser } from '@/data/user';

const SettingsAppearanceSection: React.FC = () => {
	const { user, updateUserField } = useUser();

	const handleDashboardBackgroundChange = (checked: boolean | 'indeterminate') => {
		const enabled = checked === true;
		updateUserField('dashboard_background', enabled);
		toast.success(`Dashboard background ${enabled ? 'enabled' : 'disabled'}.`);
	};

	return (
		<SettingsRows>
			<SettingsRow title='Theme' description='Choose between light and dark mode.' control={<ModeToggle />} />
			<SettingsRow
				title='Dashboard background'
				htmlFor='settings-dashboard-background'
				description='Shows an animated veil on a black backdrop behind the dashboard in dark mode. When off, the dashboard uses the same background as every other page.'
				control={
					<Checkbox
						id='settings-dashboard-background'
						checked={user.dashboard_background}
						onCheckedChange={handleDashboardBackgroundChange}
					/>
				}
			/>
		</SettingsRows>
	);
};

export default SettingsAppearanceSection;
