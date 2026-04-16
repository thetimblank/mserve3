import RamSliderField from '@/components/ram-slider-field';
import { Button } from '@/components/ui/button';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';

const SlideRam: React.FC = () => {
	const { form, updateField, continueToNext } = useCreateServer();

	return (
		<SlideShell
			title='Set memory'
			description='Choose how much RAM this server can use.'
			actions={
				<Button type='button' onClick={continueToNext}>
					Continue
				</Button>
			}>
			<RamSliderField
				id='create-server-ram'
				value={form.ram}
				onChange={(value) => updateField('ram', value)}
			/>
		</SlideShell>
	);
};

export default SlideRam;
