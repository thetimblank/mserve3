import { Palette } from 'lucide-react';
import { ModeToggle } from '@/components/mode-toggle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const SettingsAppearanceCard: React.FC = () => {
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
			</CardContent>
		</Card>
	);
};

export default SettingsAppearanceCard;
