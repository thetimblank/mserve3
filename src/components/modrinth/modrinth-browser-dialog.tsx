import React from 'react';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import ModrinthBrowser, { type ModrinthBrowserProps } from './modrinth-browser';

type ModrinthBrowserDialogProps = ModrinthBrowserProps & {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: string;
};

/** Full-screen-ish dialog hosting the Modrinth browser (server content tabs). */
const ModrinthBrowserDialog: React.FC<ModrinthBrowserDialogProps> = ({
	open,
	onOpenChange,
	title,
	description,
	...browserProps
}) => {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='flex flex-col sm:max-w-[min(95vw,90rem)] w-[95vw] h-[88vh] p-4 gap-3'>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					{description && <DialogDescription>{description}</DialogDescription>}
				</DialogHeader>
				<div className='flex-1 min-h-0'>
					<ModrinthBrowser {...browserProps} />
				</div>
			</DialogContent>
		</Dialog>
	);
};

export default ModrinthBrowserDialog;
