import * as React from 'react';
import { m } from 'motion/react';

type SlideShellProps = {
	title: string;
	description: string;
	children?: React.ReactNode;
	actions?: React.ReactNode;
	icon?: React.ReactElement;
};

const SlideShell: React.FC<SlideShellProps> = ({ title, description, children, actions, icon }) => {
	return (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='w-full max-w-lg'>
			<div className='mb-10 flex flex-col items-center'>
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
