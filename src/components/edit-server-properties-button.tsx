import React from 'react';
import { Settings } from 'lucide-react';
import { type Server } from '@/data/servers';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import EditServerPropertiesForm from '@/components/edit-server-properties-form';

type EditServerPropertiesButtonProps = {
	server: Server;
	disabled?: boolean;
	onSaved?: () => Promise<void> | void;
};

const EditServerPropertiesButton: React.FC<EditServerPropertiesButtonProps> = ({
	server,
	disabled,
	onSaved,
}) => {
	const [isOpen, setIsOpen] = React.useState(false);

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<Button variant='secondary' disabled={disabled || server.status !== 'offline'}>
					<Settings />
					Edit Properties
				</Button>
			</DialogTrigger>
			<DialogContent className='min-w-2xl'>
				<DialogHeader>
					<DialogTitle>Edit server properties</DialogTitle>
					<DialogDescription>
						Update runtime settings and storage behavior for this server.
					</DialogDescription>
				</DialogHeader>
				<EditServerPropertiesForm
					server={server}
					disabled={disabled}
					onSaved={async () => {
						setIsOpen(false);
						await onSaved?.();
					}}
					onCancel={() => setIsOpen(false)}
					showCancel
				/>
			</DialogContent>
		</Dialog>
	);
};

export default React.memo(EditServerPropertiesButton);
