import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';
import { Container } from '@/components/ui/container';

const SlideAutoRestart: React.FC = () => {
	const { form, updateField, continueToNext } = useCreateServer();

	return (
		<SlideShell
			title='Auto restart'
			description='Automatically restart this server after it closes.'
			actions={
				<Button type='button' onClick={continueToNext}>
					Continue
				</Button>
			}>
			<div className='flex items-center justify-center'>
				<Field className='w-auto '>
					<Container>
						<Label className='flex items-center gap-3'>
							<Checkbox
								checked={form.auto_restart}
								onCheckedChange={(checked) =>
									updateField('auto_restart', typeof checked === 'boolean' ? checked : false)
								}
							/>
							Auto restart server when it closes
						</Label>
					</Container>
				</Field>
			</div>
		</SlideShell>
	);
};

export default SlideAutoRestart;
