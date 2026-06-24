import { RotateCcw, Trash } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { useUser } from '@/data/user';
import { getDefaultServersRootPath } from '@/lib/server-root-path';
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
	const [serversRootPath, setServersRootPath] = React.useState(user.servers_root_path);
	const [defaultServersRootPath, setDefaultServersRootPath] = React.useState('');

	React.useEffect(() => {
		setServersRootPath(user.servers_root_path || defaultServersRootPath);
	}, [defaultServersRootPath, user.servers_root_path]);

	React.useEffect(() => {
		let active = true;

		void getDefaultServersRootPath()
			.then((path) => {
				if (!active) return;
				setDefaultServersRootPath(path);
			})
			.catch(() => {
				if (!active) return;
				setDefaultServersRootPath('');
			});

		return () => {
			active = false;
		};
	}, []);

	// Autosaves on blur. Empty input reverts to the last saved value.
	const commitServersRootPath = () => {
		const normalized = serversRootPath.trim();
		if (!normalized) {
			setServersRootPath(user.servers_root_path);
			return;
		}
		if (normalized !== user.servers_root_path) {
			updateUserField('servers_root_path', normalized);
		}
		setServersRootPath(normalized);
	};

	const handleResetServersRootPath = () => {
		const resetPath = defaultServersRootPath.trim();
		if (!resetPath) {
			toast.error('Could not resolve default server root path.');
			return;
		}

		updateUserField('servers_root_path', resetPath);
		setServersRootPath(resetPath);
		toast.success('Server root path reset to default.');
	};

	const isRootPathDefault =
		Boolean(defaultServersRootPath) && serversRootPath.trim() === defaultServersRootPath.trim();

	return (
		<Card>
			<CardHeader>
				<CardTitle>Data & Privacy</CardTitle>
				<CardDescription>Manage where your servers live and your stored data.</CardDescription>
			</CardHeader>
			<CardContent className='space-y-6'>
				<div className='space-y-2 max-w-lg'>
					<Label htmlFor='settings-servers-root-path'>Servers root path</Label>
					<InputGroup>
						<InputGroupInput
							id='settings-servers-root-path'
							className='font-mono'
							placeholder='C:\\Users\\you\\mserve\\servers'
							value={serversRootPath}
							onChange={(event) => setServersRootPath(event.target.value)}
							onBlur={commitServersRootPath}
						/>
						<InputGroupAddon align='inline-end'>
							<InputGroupButton
								type='button'
								variant='ghost'
								size='icon-xs'
								aria-label='Reset to default'
								onClick={handleResetServersRootPath}
								disabled={isRootPathDefault}>
								<RotateCcw />
							</InputGroupButton>
						</InputGroupAddon>
					</InputGroup>
					<p className='text-sm text-muted-foreground'>
						Saved automatically. New servers are created as child folders in this directory.
					</p>
				</div>

				<div className='space-y-2'>
					<p className='font-medium'>Data management</p>
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
								<AlertDialogAction
									variant='destructive'
									className='capitalize'
									onClick={onClearAllData}>
									Clear All Data
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</CardContent>
		</Card>
	);
};

export default SettingsDataCard;
