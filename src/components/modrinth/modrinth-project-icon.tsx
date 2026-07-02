import React from 'react';
import { Box } from 'lucide-react';
import { cn } from '@/lib/utils';

type ModrinthProjectIconProps = {
	iconUrl?: string | null;
	title: string;
	className?: string;
};

/** Project icon with a graceful fallback when the project has none or it 404s. */
const ModrinthProjectIcon: React.FC<ModrinthProjectIconProps> = ({ iconUrl, title, className }) => {
	const [failed, setFailed] = React.useState(false);

	React.useEffect(() => {
		setFailed(false);
	}, [iconUrl]);

	if (!iconUrl || failed) {
		return (
			<div
				className={cn(
					'flex items-center justify-center rounded-md bg-secondary text-muted-foreground shrink-0',
					className,
				)}>
				<Box className='size-1/2' />
			</div>
		);
	}

	return (
		<img
			src={iconUrl}
			alt={`${title} icon`}
			loading='lazy'
			onError={() => setFailed(true)}
			className={cn('rounded-md object-cover bg-secondary shrink-0', className)}
		/>
	);
};

export default ModrinthProjectIcon;
