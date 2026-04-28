import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';
import RamSelector from '@/components/ram-selector';

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
			{form.provider && <RamSelector provider={form.provider} ram={form.ram} updateField={updateField} />}
		</SlideShell>
	);
};

export default SlideRam;
