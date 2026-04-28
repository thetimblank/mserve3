import * as React from 'react';
import { m } from 'motion/react';
import clsx from 'clsx';

type SlideShellProps = {
	title: string;
	description: React.ReactNode;
	children?: React.ReactNode;
	actions?: React.ReactNode;
	icon?: React.ReactElement;
	fullWidth?: boolean;
	className?: string;
};

const SlideShell: React.FC<SlideShellProps> = ({
	title,
	description,
	children,
	actions,
	fullWidth,
	className,
	icon,
}) => {
	return (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className={clsx('w-full', !fullWidth && 'max-w-lg', className)}>
			<div className='mb-10 flex flex-col items-center text-center'>
				{icon && React.cloneElement(icon, { className: 'size-20 mb-6' })}
				<h1 className='text-3xl font-bold mb-2'>{title}</h1>
				<p>{description}</p>
			</div>
			{children}
			{actions && <div className='mt-10 flex items-center justify-center gap-3'>{actions}</div>}
		</m.div>
	);
};

export default SlideShell;
