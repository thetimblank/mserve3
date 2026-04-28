import { Button } from '@/components/ui/button';
import { CREATE_SERVER_SLIDE_INDEX, getCreateServerStepSlides } from '../create-server-flow';
import { useCreateServer } from '../CreateServerContext';
import SlideShell from './SlideShell';

const SlideReview: React.FC = () => {
	const { form, serverName, resolvedDirectory, isSubmitting, prevSlide, createServer } = useCreateServer();
	const visibleStepSlides = getCreateServerStepSlides(form.provider);
	const showBackups = visibleStepSlides.includes(CREATE_SERVER_SLIDE_INDEX.backups);
	const showEula = visibleStepSlides.includes(CREATE_SERVER_SLIDE_INDEX.eula);

	return (
		<SlideShell
			title='Review and create'
			description='Confirm your settings, then create the server.'
			actions={
				<>
					<Button variant='secondary' type='button' onClick={prevSlide} disabled={isSubmitting}>
						Back
					</Button>
					<Button type='button' onClick={createServer} disabled={isSubmitting}>
						{isSubmitting ? 'Creating...' : 'Create server'}
					</Button>
				</>
			}>
			<div className='rounded-lg bg-secondary/20 p-6 space-y-3'>
				<div>
					<p className='text-sm text-muted-foreground'>Name</p>
					<p>{serverName || '(not set)'}</p>
				</div>
				<div>
					<p className='text-sm text-muted-foreground'>Directory</p>
					<p className='break-all'>{resolvedDirectory || '(not set)'}</p>
				</div>
				<div>
					<p className='text-sm text-muted-foreground'>Jar file</p>
					<p className='break-all'>{form.file || '(not set)'}</p>
				</div>
				<div className='grid grid-cols-2 gap-4'>
					<div>
						<p className='text-sm text-muted-foreground'>Provider</p>
						<p>{form.provider?.name || '(not set)'}</p>
					</div>
					<div>
						<p className='text-sm text-muted-foreground'>Version</p>
						<p>{form.provider?.minecraft_version || '(not detected)'}</p>
					</div>
				</div>
				<div className='grid grid-cols-2 gap-4'>
					<div>
						<p className='text-sm text-muted-foreground'>RAM</p>
						<p>{form.ram} GB</p>
					</div>
					<div>
						<p className='text-sm text-muted-foreground'>Auto restart</p>
						<p>{form.auto_restart ? 'Enabled' : 'Disabled'}</p>
					</div>
					{showBackups && (
						<div>
							<p className='text-sm text-muted-foreground'>Backup modes</p>
							<p>{form.auto_backup.length > 0 ? form.auto_backup.join(', ') : 'Disabled'}</p>
						</div>
					)}
					{showEula && (
						<div>
							<p className='text-sm text-muted-foreground'>Auto agree EULA</p>
							<p>{form.auto_agree_eula ? 'Enabled' : 'Disabled'}</p>
						</div>
					)}
				</div>
				{showBackups && form.auto_backup.length > 0 && (
					<div className='grid grid-cols-2 gap-4'>
						<div>
							<p className='text-sm text-muted-foreground'>Storage limit</p>
							<p>{form.storage_limit} GB</p>
						</div>
						{form.auto_backup.includes('interval') && (
							<div>
								<p className='text-sm text-muted-foreground'>Backup interval</p>
								<p>{form.auto_backup_interval} minutes</p>
							</div>
						)}
					</div>
				)}
			</div>
		</SlideShell>
	);
};

export default SlideReview;
