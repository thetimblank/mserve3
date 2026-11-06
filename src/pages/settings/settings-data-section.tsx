import { RotateCcw, Trash } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SettingsRow, SettingsRows } from '@/components/settings/settings-row';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { useUser } from '@/data/user';
import { getDefaultServersRootPath } from '@/lib/server-root-path';
import { examplePaths } from '@/lib/platform';
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

type SettingsDataSectionProps = {
	onClearAllData: () => void;
	/** False while any server runs: it would keep running with nothing left to stop it. */
	canClearAllData: boolean;
};

const SettingsDataSection: React.FC<SettingsDataSectionProps> = ({ onClearAllData, canClearAllData }) => {
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
		<SettingsRows>
			<SettingsRow
				title='Servers root path'
				htmlFor='settings-servers-root-path'
				description='Saved automatically. New servers are created as child folders in this directory.'>
				<InputGroup>
					<InputGroupInput
						id='settings-servers-root-path'
						className='font-mono'
						placeholder={examplePaths.serversRoot}
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
			</SettingsRow>

			<SettingsRow
				title='Clear all data'
				description={
					canClearAllData
						? 'Remove every server and network from mserve and restore all settings to their defaults. Server files on disk are not deleted.'
						: 'Stop every server before clearing all data.'
				}
				control={
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button variant='destructive-secondary' disabled={!canClearAllData}>
								<Trash />
								Clear All Data
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Are you sure?</AlertDialogTitle>
								<AlertDialogDescription>
									This removes every server and network from mserve and restores all settings to their
									defaults. Server files on disk are not deleted.
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
				}
			/>
		</SettingsRows>
	);
};

export default SettingsDataSection;
