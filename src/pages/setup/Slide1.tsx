import { m } from 'motion/react';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useSetup } from './SetupContext';
import { useUser } from '@/data/user';

export default function Slide1() {
	const { nextSlide, updateData, data } = useSetup();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { user } = useUser();

	useEffect(() => {
		if (user.completed_setup_hosting_ports.includes(data.port)) {
			setError('You have already set firewall port ' + data.port);
		} else {
			setError(null);
		}
	}, [user.completed_setup_hosting_ports, data.port]);

	const onSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);

		const port = Number(data.port);
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			setError('Port must be between 1 and 65535.');
			return;
		}

		if (user.completed_setup_hosting_ports.includes(data.port)) {
			setError('You have already set firewall port ' + data.port + '.');
			return;
		}

		setIsSubmitting(true);
		try {
			const forwardPromise = invoke<string[]>('forward_port_windows_firewall', { port });
			toast.promise(forwardPromise, {
				loading: `Adding firewall rules for port ${port}...`,
				success: 'Firewall rules created.',
				error: (err) => (err instanceof Error ? err.message : 'Failed to create firewall rules.'),
			});

			await forwardPromise;
			nextSlide();
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to create firewall rules.';
			setError(message);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='flex flex-col items-center max-w-lg'>
			<p className='text-center text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>
				Setup Port Forwarding on your PC
			</p>
			<p className='mb-20 text-center'>
				This will allow your server to be seen by other players. (Part 1/2)
			</p>
			<form onSubmit={onSubmit} className='flex flex-col items-start'>
				<p>Which Port would you like to use to port forward?</p>
				<p className='text-muted-foreground text-sm'>
					Recommended is 25565. We will automatically setup TCP and UDP rules on your windows firewall.
				</p>
				<Field className='flex flex-col mt-8 gap-1'>
					<Label htmlFor='server-port'>Port</Label>
					<Input
						id='server-port'
						type='number'
						value={data.port}
						onChange={(event) => updateData('port', Number(event.currentTarget.value))}
						required
					/>
				</Field>
				{error && <p className='text-sm text-destructive mt-1'>{error}</p>}
				<div className='ml-auto mt-4 flex gap-2'>
					<Button type='button' variant='secondary' onClick={nextSlide}>
						Skip Step
					</Button>
					<Button type='submit' disabled={isSubmitting || !!error}>
						{isSubmitting && <Spinner />}
						Forward Port
					</Button>
				</div>
			</form>
		</m.div>
	);
}
