import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';

type OpenFolderButtonProps = {
	directory?: string;
	targetPath?: string;
	disabled?: boolean;
	variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'ghost' | 'link';
	className?: string;
	label?: string;
	onError?: (message: string) => void;
};

const OpenFolderButton: React.FC<OpenFolderButtonProps> = ({
	directory,
	targetPath,
	disabled,
	variant = 'secondary',
	className,
	label = 'Open Folder',
	onError,
}) => {
	const [isOpening, setIsOpening] = React.useState(false);

	const handleClick = async () => {
		if (disabled || isOpening) return;

		setIsOpening(true);
		try {
			if (targetPath) {
				await invoke('open_server_path', { path: targetPath });
			} else if (directory) {
				await invoke('open_server_folder', { directory });
			} else {
				throw new Error('No path available to open.');
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to open folder.';
			if (onError) onError(message);
			else window.alert(message);
		} finally {
			setIsOpening(false);
		}
	};

	return (
		<Button variant={variant} onClick={handleClick} disabled={disabled || isOpening} className={className}>
			<Folder />
			<p>{label}</p>
		</Button>
	);
};

export default OpenFolderButton;
