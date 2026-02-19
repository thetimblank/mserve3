import { Server } from '@/data/servers';
import clsx from 'clsx';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
	server: Server;
}

export default function MotdGenerator({ server, className, ...props }: Props) {
	return (
		<div className={clsx('bg-neutral-900 rounded-xl font-mono p-2', className)} {...props}>
			<p>hello jarvis</p>
			<p>whats up</p>
		</div>
	);
}
