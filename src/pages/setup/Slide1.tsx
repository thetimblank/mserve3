import { m } from 'motion/react';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useSetup } from './SetupContext';

export default function Slide1() {
	const { nextSlide, updateData, data } = useSetup();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const onSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);

		setIsSubmitting(true);
		try {
			// const payload: InitServerPayload = {
			// 	directory,
			// 	createDirectoryIfMissing: form.createDirectoryIfMissing,
			// 	file: form.file.trim() || 'server.jar',
			// 	ram: Math.max(1, Number(form.ram) || 3),
			// 	autoRestart: form.autoRestart,
			// 	autoBackup: form.autoBackup,
			// 	autoBackupInterval: Math.max(1, Number(form.autoBackupInterval) || 120),
			// 	autoAgreeEula: form.autoAgreeEula,
			// };
			// const initializePromise = (async () => {
			// 	const res = await invoke<InitServerResult>('initialize_server', { payload });
			// 	if (!res.ok) {
			// 		throw new Error(res.message || 'Failed to initialize server.');
			// 	}
			// 	return res;
			// })();
			// toast.promise(initializePromise, {
			// 	loading: 'Creating server...',
			// 	success: () => `Server "${getDirectoryName(directory)}" has been created`,
			// 	error: (err) => (err instanceof Error ? err.message : 'Failed to create server.'),
			// });
			// const result = await initializePromise;
			// addServer(buildServer(payload, result));
			// resetForm();
			nextSlide();
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to initialize server.';
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
				{error && <p className='text-sm text-destructive'>{error}</p>}
				<Button type='submit' disabled={isSubmitting} className='mt-4 ml-auto'>
					{isSubmitting && <Spinner />}
					Forward Port
				</Button>
			</form>
		</m.div>
	);
}
