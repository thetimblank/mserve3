import { Trash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
	return (
		<Card>
			<CardHeader>
				<CardTitle>Data & Privacy</CardTitle>
				<CardDescription>Manage your data</CardDescription>
			</CardHeader>
			<CardContent className='space-y-3'>
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
