import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Container } from '@/components/ui/container';
import { AutoBackupFields } from '@/components/auto-backup-fields';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';

const SlideBackups: React.FC = () => {
	const { form, updateField, continueToNext } = useCreateServer();

	return (
		<SlideShell
			title='Backup settings'
			description='Choose backup behavior and limits.'
			helpTopic='backups'
			actions={
				<Button type='button' onClick={continueToNext}>
					Continue
				</Button>
			}>
			<FieldGroup className='gap-0'>
				<Container>
					<AutoBackupFields values={form} onFieldChange={updateField} idPrefix='create-server' />
				</Container>
			</FieldGroup>
		</SlideShell>
	);
};

export default SlideBackups;
