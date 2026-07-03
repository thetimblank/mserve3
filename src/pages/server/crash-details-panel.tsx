import React from 'react';
import { CircleAlert, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import type { CrashInfo } from './server-types';

type Props = {
	crash: CrashInfo;
	isBusy: boolean;
	onRestart: () => void;
	onDismiss: () => void;
};

/**
 * Shown on the server overview when a run ended in `crashed`. Surfaces the exit
 * code and the tail of stderr the backend captured, plus a one-click restart.
 * Backend crash-protection may already be restarting; this panel is the manual
 * path and the post-mortem.
 */
const CrashDetailsPanel: React.FC<Props> = ({ crash, isBusy, onRestart, onDismiss }) => {
	const [expanded, setExpanded] = React.useState(false);
	const hasStderr = crash.stderrTail.length > 0;

	return (
		<Container variant='destructive' className='space-y-3'>
			<div className='flex items-start gap-3'>
				<CircleAlert className='mt-0.5 size-5 shrink-0 text-destructive' />
				<div className='min-w-0 flex-1 space-y-1'>
					<p className='font-semibold text-destructive'>Server crashed</p>
					<p className='text-sm text-muted-foreground'>
						{crash.exitCode != null
							? `The server process exited unexpectedly with code ${crash.exitCode}.`
							: 'The server process exited unexpectedly.'}{' '}
						{crash.at.toLocaleTimeString()}
					</p>
				</div>
				<Button
					variant='ghost'
					size='icon'
					className='shrink-0'
					onClick={onDismiss}
					aria-label='Dismiss crash details'>
					<X className='size-4' />
				</Button>
			</div>

			{hasStderr && (
				<div className='space-y-2'>
					<Button variant='outline' size='sm' onClick={() => setExpanded((value) => !value)}>
						{expanded ? 'Hide' : 'Show'} last output ({crash.stderrTail.length} lines)
					</Button>
					{expanded && (
						<pre className='max-h-56 overflow-auto app-scroll-area rounded-md bg-black/40 p-3 text-xs whitespace-pre-wrap break-all'>
							{crash.stderrTail.join('\n')}
						</pre>
					)}
				</div>
			)}

			<div className='flex flex-wrap gap-2'>
				<Button onClick={onRestart} disabled={isBusy}>
					<RotateCcw className='size-4' />
					Restart server
				</Button>
			</div>
		</Container>
	);
};

export default CrashDetailsPanel;
