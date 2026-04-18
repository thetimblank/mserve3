import { Trash } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUser } from '@/data/user';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type SettingsDataCardProps = {
	onClearAllData: () => void;
};

const SettingsDataCard: React.FC<SettingsDataCardProps> = ({ onClearAllData }) => {
	const { user, updateUserField } = useUser();
	const [javaDefault, setJavaDefault] = React.useState(user.java_installation_default);

	React.useEffect(() => {
		setJavaDefault(user.java_installation_default);
	}, [user.java_installation_default]);

	const handleSaveJavaDefault = () => {
		const normalized = javaDefault.trim() || 'java';
		updateUserField('java_installation_default', normalized);
		setJavaDefault(normalized);
		toast.success('Default Java installation updated.');
	};

	const handleResetJavaDefault = () => {
		updateUserField('java_installation_default', 'java');
		setJavaDefault('java');
		toast.success('Default Java installation reset to java.');
	};

	const handleAdvancedModeChange = (checked: boolean | 'indeterminate') => {
		const enabled = checked === true;
		updateUserField('advanced_mode', enabled);
		toast.success(`Advanced mode ${enabled ? 'enabled' : 'disabled'}.`);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Data & Privacy</CardTitle>
				<CardDescription>Manage your data</CardDescription>
			</CardHeader>
			<CardContent className='space-y-1'>
				<div className='space-y-2'>
					<Label htmlFor='settings-java-default'>Default Java installation</Label>
					<Input
						id='settings-java-default'
						className='font-mono'
						placeholder='java'
						value={javaDefault}
						onChange={(event) => setJavaDefault(event.target.value)}
					/>
					<p className='text-sm text-muted-foreground'>
						Used when a server does not set its own Java override.
					</p>
					<div className='flex gap-2'>
						<Button onClick={handleSaveJavaDefault}>Save</Button>
						<Button variant='destructive-secondary' onClick={handleResetJavaDefault}>
							Reset to java
						</Button>
					</div>
				</div>

				<div className='space-y-2 mt-6'>
					<Label className='flex items-center gap-3'>
						<Checkbox checked={user.advanced_mode} onCheckedChange={handleAdvancedModeChange} />
						Advanced Mode
					</Label>
					<p className='text-sm text-muted-foreground'>
						Lets you bypass RAM safety caps and use the full detected system range.
					</p>
				</div>

				<p className='font-medium mt-6'>Data management</p>
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button variant='destructive-secondary'>
							<Trash />
							Clear All Data
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Are you sure?</AlertDialogTitle>
							<AlertDialogDescription>
								This will remove all servers and restore defaults forever.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction variant='destructive' className='capitalize' onClick={onClearAllData}>
								Clear All Data
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</CardContent>
		</Card>
	);
};

export default SettingsDataCard;
