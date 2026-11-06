/**
 * Entrance animation wrapper for one card in a bento cluster. Fills its grid
 * cell (`h-full`) so cards in a row line up.
 */
import React from 'react';
import { m } from 'motion/react';

import { cn } from '@/lib/utils';

type Props = { delay?: number; className?: string; children: React.ReactNode };

const BentoItem: React.FC<Props> = ({ delay = 0, className, children }) => (
	<m.div
		initial={{ scale: 0.96, y: 8, opacity: 0 }}
		animate={{ scale: 1, y: 0, opacity: 1 }}
		transition={{ type: 'spring', duration: 0.4, bounce: 0, delay }}
		className={cn('h-full min-w-0', className)}>
		{children}
	</m.div>
);

export default BentoItem;
