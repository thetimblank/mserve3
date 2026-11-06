import { Button } from '@/components/ui/button';
import { AutoBackupFields } from '@/components/auto-backup-fields';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';

const SlideBackups: React.FC = () => {
	const { form, serversRootPath, updateField, continueToNext } = useCreateServer();

	return (
		<SlideShell
			title='Backups'
			description='A backup is a copy of your server you can go back to if something breaks.'
			helpTopic='backups'
			actions={
				<Button type='button' onClick={continueToNext}>
					Continue
				</Button>
			}>
			<AutoBackupFields
				values={form}
				onFieldChange={updateField}
				idPrefix='create-server'
				directory={serversRootPath}
				showOnStart={false}
			/>
		</SlideShell>
	);
};

export default SlideBackups;
