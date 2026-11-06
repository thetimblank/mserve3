import { HelpButton } from '@/components/help/help-button';
import { ToggleCard } from '@/components/toggle-card';
import { Button } from '@/components/ui/button';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';

const SlideAutoRestart: React.FC = () => {
	const { form, updateField, continueToNext } = useCreateServer();

	return (
		<SlideShell
			title='Auto restart'
			description='Keep the server up without having to watch it.'
			actions={
				<Button type='button' onClick={continueToNext}>
					Continue
				</Button>
			}>
			<ToggleCard
				id='create-server-auto-restart'
				title='Restart after a crash'
				description='Starts the server again when it closes without you stopping it.'
				titleAddon={<HelpButton topic='auto-restart' />}
				checked={form.auto_restart}
				onCheckedChange={(checked) => updateField('auto_restart', checked)}
			/>
		</SlideShell>
	);
};

export default SlideAutoRestart;
