import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useServers } from '@/data/servers';
import {
	findServerByName,
	useCreateServer,
	validateServerName,
	type PathValidationResult,
} from '../CreateServerContext';
import SlideShell from './SlideShell';
import { AnimatePresence, m } from 'motion/react';

const SlideDirectory: React.FC = () => {
	const { servers } = useServers();
	const {
		serverName,
		setServerName,
		serversRootPath,
		resolvedDirectory,
		isResolvingServersRootPath,
		setError,
		clearError,
		nextSlide,
	} = useCreateServer();

	const duplicateServer = findServerByName(servers, serverName);

	const onContinue = async () => {
		const nameError = validateServerName(serverName, servers);
		if (nameError) {
			setError(nameError);
			return;
		}

		if (isResolvingServersRootPath) {
			setError('Still finding your servers root path. Try again in a moment.');
			return;
		}

		if (!serversRootPath.trim()) {
			setError('Set a servers root path in Settings > Data & storage first.');
			return;
		}

		if (resolvedDirectory) {
			const pathResult = await invoke<PathValidationResult>('validate_path', {
				path: resolvedDirectory,
			}).catch(() => null);
			if (pathResult?.exists) {
				setError('A folder with this name already exists. Choose another name.');
				return;
			}
		}

		clearError();
		nextSlide();
	};

	return (
		<SlideShell
			title='Name your server'
			description="Pick a name you'll recognize. mserve creates the server's folder for you."
			actions={
				<Button type='button' onClick={onContinue}>
					Continue
				</Button>
			}>
			<FieldGroup className='gap-3'>
				<Field>
					<Label htmlFor='create-server-name'>Server name</Label>
					<Input
						id='create-server-name'
						placeholder='My Server'
						value={serverName}
						onChange={(event) => {
							setServerName(event.target.value);
							clearError();
						}}
					/>
				</Field>
				<AnimatePresence>
					{duplicateServer && (
						<m.p
							initial={{ opacity: 0, height: 0 }}
							animate={{ height: 'auto', opacity: 1 }}
							transition={{ type: 'spring', duration: 0.2, bounce: 0 }}
							className='text-sm text-destructive'>
							You already have a server with this name.
						</m.p>
					)}
				</AnimatePresence>
			</FieldGroup>
		</SlideShell>
	);
};

export default SlideDirectory;
