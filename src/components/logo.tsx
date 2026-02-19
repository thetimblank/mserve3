import clsx from 'clsx';
import { m } from 'motion/react';
import React from 'react';

export default function Logo({
	size = 'md',
	delay = 0,
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement> & { delay?: number; size?: 'sm' | 'md' | 'lg' }) {
	if (size === 'lg') {
		return (
			<div className={clsx('size-20 flex relative select-none overflow-hidden', className)} {...props}>
				<m.p
					initial={{ top: '149%', opacity: 0 }}
					animate={{ top: '49%', opacity: 1 }}
					transition={{ type: 'spring', duration: 0.3, bounce: 0, delay: delay }}
					className='text-[85px] font-black text-mserve-accent size-0 leading-0 absolute left-[-8%]'>
					M
				</m.p>
				<m.p
					initial={{ left: '71%', opacity: 0 }}
					animate={{ left: '88.5%', opacity: 1 }}
					transition={{ type: 'spring', duration: 0.3, bounce: 0, delay: 0.3 + delay }}
					className='text-[20.5px] font-bold text-mserve-accent size-0 leading-0 absolute top-[90%] -rotate-90'>
					SERVE
				</m.p>
			</div>
		);
	}

	if (size === 'md') {
		return (
			<div className={clsx('size-10 flex relative select-none overflow-hidden', className)} {...props}>
				<m.p
					initial={{ top: '99%', opacity: 0 }}
					animate={{ top: '49%', opacity: 1 }}
					transition={{
						type: 'spring',
						duration: 0.3,
						bounce: 0,
						delay: delay,
					}}
					className='text-[42.5px] font-black text-mserve-accent size-0 leading-0 absolute left-[-7%]'>
					M
				</m.p>
				<m.p
					initial={{ left: '71%', opacity: 0 }}
					animate={{ left: '91%', opacity: 1 }}
					transition={{
						type: 'spring',
						duration: 0.3,
						bounce: 0,
						delay: 0.3 + delay,
					}}
					className='text-[10.25px] font-bold text-mserve-accent size-0 leading-0 absolute top-[90%] -rotate-90'>
					SERVE
				</m.p>
			</div>
		);
	}
}
