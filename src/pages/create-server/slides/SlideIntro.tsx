import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
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
			}>
			<p className='text-sm text-muted-foreground text-center'>
				More advanced features are available in advanced mode. Turn it on in{' '}
				<Link className='underline underline-offset-4' to='/settings'>
					settings
				</Link>
				.
			</p>
		</SlideShell>
	);
};

export default SlideIntro;
