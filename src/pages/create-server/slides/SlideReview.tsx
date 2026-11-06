import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CREATE_SERVER_SLIDE_INDEX, createServerNeedsEula, getCreateServerStepSlides } from '../create-server-flow';
import { useCreateServer } from '../CreateServerContext';
import { describeAutoBackup } from '../review-summary';
import SlideShell from './SlideShell';
import { Container } from '@/components/ui/container';
import { formatRamLabel } from '@/lib/ram-utils';

const SlideReview: React.FC = () => {
	const {
		form,
		updateField,
		clearError,
		serverName,
		resolvedDirectory,
		isSubmitting,
		prevSlide,
		createServer,
		modpack,
		modpackInstallProgress,
	} = useCreateServer();
	const visibleStepSlides = getCreateServerStepSlides(form.provider);
	const showBackups = visibleStepSlides.some((step) => step === CREATE_SERVER_SLIDE_INDEX.backups);
	const needsEula = createServerNeedsEula(form.provider);
	const canCreate = !needsEula || form.auto_agree_eula;

	return (
		<SlideShell
			title='Review and create'
			description='Confirm your settings, then create the server.'
			actions={
				<>
					<Button variant='secondary' type='button' onClick={prevSlide} disabled={isSubmitting}>
						Back
					</Button>
					<Button type='button' onClick={createServer} disabled={isSubmitting || !canCreate}>
						{isSubmitting ? 'Creating...' : 'Create server'}
					</Button>
				</>
			}>
			<Container className='space-y-3'>
				<div>
					<p className='text-sm text-muted-foreground'>Name</p>
					<p>{serverName || '(not set)'}</p>
				</div>
				<div>
					<p className='text-sm text-muted-foreground'>Directory</p>
					<p className='break-all'>{resolvedDirectory || '(not set)'}</p>
				</div>
				{modpack ? (
					<div className='grid grid-cols-2 gap-4'>
						<div>
							<p className='text-sm text-muted-foreground'>Modpack</p>
							<p>
								{modpack.title}{' '}
								<span className='text-muted-foreground'>{modpack.version.versionNumber}</span>
							</p>
						</div>
						<div>
							<p className='text-sm text-muted-foreground'>Version</p>
							<p>{modpack.version.gameVersions[0] ?? '(from modpack)'}</p>
						</div>
					</div>
				) : (
					<>
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
					</>
				)}
				<div className='grid grid-cols-2 gap-4'>
					<div>
						<p className='text-sm text-muted-foreground'>RAM</p>
						<p>{form.ram_mode === 'auto' ? 'Auto' : formatRamLabel(form.ram)}</p>
					</div>
					<div>
						<p className='text-sm text-muted-foreground'>Auto restart</p>
						<p>{form.auto_restart ? 'Enabled' : 'Disabled'}</p>
					</div>
					{showBackups && (
						<div>
							<p className='text-sm text-muted-foreground'>Backups</p>
							<p>{describeAutoBackup(form.auto_backup, form.auto_backup_interval)}</p>
						</div>
					)}
					{showBackups && form.auto_backup.length > 0 && (
						<div>
							<p className='text-sm text-muted-foreground'>Space for backups</p>
							<p>{form.storage_limit} GB</p>
						</div>
					)}
				</div>
				{isSubmitting && modpackInstallProgress && (
					<div className='space-y-2 rounded-md border-2 p-3'>
						<p className='text-sm'>{modpackInstallProgress.message}</p>
						<div className='h-2 w-full rounded-full bg-secondary overflow-hidden'>
							<div
								className='h-full bg-accent transition-[width] duration-200 ease-linear'
								style={{
									width: `${Math.round(
										Math.max(0, Math.min(1, modpackInstallProgress.progress)) * 100,
									)}%`,
								}}
							/>
						</div>
					</div>
				)}
			</Container>
			{needsEula && (
				<Container className='mt-4 flex items-start gap-3'>
					<Checkbox
						id='create-server-eula'
						className='mt-0.5 size-5'
						aria-describedby='create-server-eula-description'
						checked={form.auto_agree_eula}
						disabled={isSubmitting}
						onCheckedChange={(checked) => {
							updateField('auto_agree_eula', checked === true);
							clearError();
						}}
					/>
					<div className='space-y-1'>
						<label htmlFor='create-server-eula' className='cursor-pointer font-semibold leading-snug'>
							I accept Mojang&apos;s Server EULA
						</label>
						<p id='create-server-eula-description' className='text-sm text-muted-foreground'>
							Required to run a Minecraft server. mserve accepts it in the server folder for you.
						</p>
						<a
							href='https://aka.ms/MinecraftEULA'
							target='_blank'
							rel='noreferrer'
							className='inline-flex items-center gap-1 text-sm underline underline-offset-4'>
							Read the EULA
							<ExternalLink className='size-3.5' />
						</a>
					</div>
				</Container>
			)}
		</SlideShell>
	);
};

export default SlideReview;
