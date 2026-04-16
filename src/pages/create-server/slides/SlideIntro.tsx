import { Button } from '@/components/ui/button';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';
import { Server } from 'lucide-react';

const SlideIntro: React.FC = () => {
	const { hasStarted, isDirty, startFlow, resetDraft, clearError } = useCreateServer();
	const canReset = hasStarted || isDirty;

	return (
		<SlideShell
			icon={<Server />}
			title='Create a New Server'
			description='We will walk through your server setup one step at a time.'
			actions={
				<>
					<Button
						onClick={() => {
							clearError();
							startFlow();
						}}>
						Continue
					</Button>
					{canReset && (
						<Button
							variant='link'
							onClick={() => {
								clearError();
								resetDraft();
							}}>
							Reset
						</Button>
					)}
				</>
			}
		/>
	);
};

export default SlideIntro;
