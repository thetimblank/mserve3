import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';

const SlideEula: React.FC = () => {
	const { form, updateField, continueToNext } = useCreateServer();

	return (
		<SlideShell
			title='EULA'
			description='You can automatically accept eula.txt when this server is first initialized.'
			actions={
				<Button type='button' onClick={continueToNext}>
					Continue
				</Button>
			}>
			<div className='flex items-center justify-center'>
				<Field className='w-auto bg-secondary p-6 rounded-lg'>
					<Label className='flex items-center gap-3'>
						<Checkbox
							className='border-secondary-foreground/50'
							checked={form.auto_agree_eula}
							onCheckedChange={(checked) =>
								updateField('auto_agree_eula', typeof checked === 'boolean' ? checked : false)
							}
						/>
						Auto agree to eula.txt
					</Label>
				</Field>
			</div>
		</SlideShell>
	);
};

export default SlideEula;
