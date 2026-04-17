import { Button } from '@/components/ui/button';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';

const SlideReview: React.FC = () => {
	const { form, isSubmitting, prevSlide, createServer } = useCreateServer();

	return (
		<SlideShell
			title='Review and create'
			description='Confirm your settings, then create the server.'
			actions={
				<>
					<Button variant='outline' type='button' onClick={prevSlide} disabled={isSubmitting}>
						Back
					</Button>
					<Button type='button' onClick={createServer} disabled={isSubmitting}>
						{isSubmitting ? 'Creating...' : 'Create server'}
					</Button>
				</>
			}>
			<div className='rounded-lg bg-secondary p-6 space-y-3'>
				<div>
					<p className='text-sm text-muted-foreground'>Directory</p>
					<p className='break-all'>{form.directory || '(not set)'}</p>
				</div>
				<div>
					<p className='text-sm text-muted-foreground'>Jar file</p>
					<p className='break-all'>{form.file || '(not set)'}</p>
				</div>
				<div className='grid grid-cols-2 gap-4'>
					<div>
						<p className='text-sm text-muted-foreground'>Provider</p>
						<p>{form.provider || '(not set)'}</p>
					</div>
					<div>
						<p className='text-sm text-muted-foreground'>Version</p>
						<p>{form.version || '(not detected)'}</p>
					</div>
				</div>
				<div className='grid grid-cols-2 gap-4'>
					<div>
						<p className='text-sm text-muted-foreground'>RAM</p>
						<p>{form.ram} GB</p>
					</div>
					<div>
						<p className='text-sm text-muted-foreground'>Auto restart</p>
						<p>{form.autoRestart ? 'Enabled' : 'Disabled'}</p>
					</div>
					<div>
						<p className='text-sm text-muted-foreground'>Backup modes</p>
						<p>{form.autoBackup.length > 0 ? form.autoBackup.join(', ') : 'Disabled'}</p>
					</div>
					<div>
						<p className='text-sm text-muted-foreground'>Auto agree EULA</p>
						<p>{form.autoAgreeEula ? 'Enabled' : 'Disabled'}</p>
					</div>
				</div>
				{form.autoBackup.length > 0 && (
					<div className='grid grid-cols-2 gap-4'>
						<div>
							<p className='text-sm text-muted-foreground'>Storage limit</p>
							<p>{form.storageLimit} GB</p>
						</div>
						{form.autoBackup.includes('interval') && (
							<div>
								<p className='text-sm text-muted-foreground'>Backup interval</p>
								<p>{form.autoBackupInterval} minutes</p>
							</div>
						)}
					</div>
				)}
			</div>
		</SlideShell>
	);
};

export default SlideReview;
