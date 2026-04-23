import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { ExternalLink } from 'lucide-react';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';

const SlideEula: React.FC = () => {
	const { form, updateField, continueToNext } = useCreateServer();

	return (
		<SlideShell
			title='EULA'
			description={
				<span className='inline-flex items-center flex-col text-center'>
					To create a Minecraft Java server, you must agree to
					<a
						href='https://aka.ms/MinecraftEULA'
						target='_blank'
						rel='noreferrer'
						className='text-sm inline-flex items-center gap-1 underline underline-offset-4 mb-4'>
						Mojang&apos;s Server EULA
						<ExternalLink className='size-4' />
					</a>
				</span>
			}
			actions={
				<Button type='button' onClick={continueToNext}>
					Continue
				</Button>
			}>
			<div className='flex items-center justify-center'>
				<Field className='w-auto bg-secondary/20 p-6 rounded-lg'>
					<Label className='flex items-center gap-3'>
						<Checkbox
							checked={form.auto_agree_eula}
							onCheckedChange={(checked) =>
								updateField('auto_agree_eula', typeof checked === 'boolean' ? checked : false)
							}
						/>
						I agree and authorize mserve to allow the eula for me
					</Label>
				</Field>
			</div>
		</SlideShell>
	);
};

export default SlideEula;
