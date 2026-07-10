/**
 * The "block card" that enters/exits the Apple-springboard edit mode. Lives as the
 * trailing tile in the fixed metrics row (replacing the old gear "Customize"
 * button). Toggles the bento's edit mode; while active it reads "Done".
 */
import React from 'react';
import { m } from 'motion/react';
import { Check, LayoutGrid } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Props = { active: boolean; onToggle: () => void; delay?: number };

const EditLayoutTile: React.FC<Props> = ({ active, onToggle, delay = 0 }) => (
	<m.div
		initial={{ scale: 0.95, y: 8, opacity: 0 }}
		animate={{ scale: 1, y: 0, opacity: 1 }}
		transition={{ type: 'spring', duration: 0.4, bounce: 0, delay }}>
		<button type='button' onClick={onToggle} className='block w-full text-left'>
			<Card
				className={cn(
					'relative h-full gap-0 overflow-hidden p-5 transition-colors',
					active
						? 'border-primary bg-primary/10 dark:bg-primary/15'
						: 'hover:border-primary/50 hover:bg-accent/20',
				)}>
				<div className='flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase'>
					<span className='text-mserve-accent [&_svg]:size-4'>
						{active ? <Check /> : <LayoutGrid />}
					</span>
					{active ? 'Editing layout' : 'Customize'}
				</div>
				<div className='mt-2 text-2xl font-bold'>{active ? 'Done' : 'Edit layout'}</div>
				<div className='mt-1 text-xs text-muted-foreground'>
					{active ? 'Finish rearranging' : 'Rearrange & hide cards'}
				</div>
			</Card>
		</button>
	</m.div>
);

export default EditLayoutTile;
