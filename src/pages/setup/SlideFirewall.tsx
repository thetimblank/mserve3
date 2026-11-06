import { SlideFrame, useSlideshow } from '@/components/slideshow';
import { toast } from 'sonner';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CircleCheck, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useSetup } from './SetupContext';
import { useUser } from '@/data/user';
import { getErrorMessage } from '@/lib/utils';
import { SetupCallout } from './setup-callout';
import { isValidPort } from './setup-steps';

export default function SlideFirewall() {
	const { nextSlide } = useSlideshow();
	const { data } = useSetup();
	const { user } = useUser();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const port = data.port;
	const alreadyAllowed = user.completed_setup_hosting_ports.includes(port);

	const handleAllow = async () => {
		setError(null);
		if (!isValidPort(port)) {
			setError('Port must be between 1 and 65535.');
			return;
		}

		setIsSubmitting(true);
		try {
			const forwardPromise = invoke<string[]>('forward_port_firewall', { port });
			toast.promise(forwardPromise, {
				loading: `Adding firewall rules for port ${port}...`,
				success: 'Firewall rules created.',
				error: (err) => getErrorMessage(err, 'Failed to create firewall rules.'),
			});

			await forwardPromise;
			nextSlide();
		} catch (err) {
			setError(getErrorMessage(err, 'Failed to create firewall rules.'));
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<SlideFrame className='flex w-full max-w-lg flex-col items-center'>
			<ShieldCheck className='mb-6 size-16' />
			<h1 className='text-center text-3xl font-bold mb-2'>Allow the port on this PC</h1>
			<p className='mb-10 text-center text-muted-foreground'>
				Your router now sends players to this PC. Its firewall decides whether they get in. (Part 2 of 2)
			</p>

			<div className='flex w-full flex-col items-start gap-4'>
				<p>
					mserve adds firewall rules for port <span className='font-mono font-semibold'>{port}</span> to
					your system firewall (Windows Defender Firewall, or firewalld/ufw on Linux).
				</p>
				<p className='text-sm text-muted-foreground'>
					You may be asked for administrator access. To use another port, go back one step.
				</p>
				{alreadyAllowed && (
					<SetupCallout icon={CircleCheck} title={`You finished this guide for port ${port} before`}>
						<p>Its firewall rules are probably in place. Adding them again is safe if you skipped this step.</p>
					</SetupCallout>
				)}
				{error && <p className='text-sm text-destructive'>{error}</p>}
				<div className='ml-auto flex gap-2'>
					{alreadyAllowed ? (
						<>
							<Button variant='secondary' onClick={handleAllow} disabled={isSubmitting}>
								{isSubmitting && <Spinner />}
								Allow again
							</Button>
							<Button onClick={nextSlide}>Continue</Button>
						</>
					) : (
						<>
							<Button variant='secondary' onClick={nextSlide}>
								Skip step
							</Button>
							<Button onClick={handleAllow} disabled={isSubmitting}>
								{isSubmitting && <Spinner />}
								Allow port {port}
							</Button>
						</>
					)}
				</div>
			</div>
		</SlideFrame>
	);
}
