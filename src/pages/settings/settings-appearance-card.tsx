import * as React from 'react';
import { Palette } from 'lucide-react';
import { toast } from 'sonner';
import { ModeToggle } from '@/components/mode-toggle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useUser } from '@/data/user';

const SettingsAppearanceCard: React.FC = () => {
	const { user, updateUserField } = useUser();

	const handleDashboardBackgroundChange = (checked: boolean | 'indeterminate') => {
		const enabled = checked === true;
		updateUserField('dashboard_background', enabled);
		toast.success(`Dashboard background ${enabled ? 'enabled' : 'disabled'}.`);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className='flex items-center gap-2'>
					<Palette className='w-5 h-5' />
					Appearance
				</CardTitle>
				<CardDescription>Customize how the app looks</CardDescription>
			</CardHeader>
			<CardContent className='space-y-4'>
				<div className='flex items-center gap-4'>
					<ModeToggle />
					<div>
						<p className='font-medium'>Theme</p>
						<p className='text-sm text-muted-foreground'>Choose between light and dark mode</p>
					</div>
				</div>
				<div className='space-y-2'>
					<Label className='flex items-center gap-3'>
						<Checkbox checked={user.dashboard_background} onCheckedChange={handleDashboardBackgroundChange} />
						Dashboard background
					</Label>
					<p className='text-sm text-muted-foreground'>
						Shows an animated veil on a black backdrop behind the dashboard in dark mode. When off, the
						dashboard uses the same background as every other page.
					</p>
				</div>
			</CardContent>
		</Card>
	);
};

export default SettingsAppearanceCard;
