import { Link } from 'react-router-dom';
import { Info, Loader, RefreshCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { UserData } from '@/data/user';
import type { ManagedServerConfigFileDefinition } from '@/lib/server-config-files';

export const EditorHeader = ({
	definition,
	isDirty,
	onReload,
	disabled,
}: {
	definition: ManagedServerConfigFileDefinition;
	isDirty: boolean;
	onReload: () => Promise<void> | void;
	disabled: boolean;
}) => (
	<div className='flex flex-wrap items-start justify-between gap-4'>
		<div className='space-y-1'>
			<p className='text-xl font-semibold'>{definition.title}</p>
			<p className='text-sm text-muted-foreground'>{definition.description}</p>
		</div>
		<div className='flex flex-wrap items-center gap-2'>
			{isDirty && (
				<span className='rounded-md border-2 font-semibold border-destructive px-3 text-sm py-1 text-destructive'>
					Unsaved
				</span>
			)}
			<Button type='button' variant='secondary' onClick={onReload} disabled={disabled}>
				<RefreshCcw />
				Reload
			</Button>
		</div>
	</div>
);

export const NetworkingDisclaimer = ({
	user,
	definition,
}: {
	user: UserData;
	definition: ManagedServerConfigFileDefinition;
}) => {
	if (!definition.networkingDisclaimer || !user.advanced_mode) return null;

	return (
		<div className='rounded-md border-2 border-warning bg-warning/10 font-semibold p-4 text-sm text-warning-foreground flex gap-3 items-center'>
			<Info className='text-warning-foreground size-8 shrink-0' />
			<div>
				Server networking is automatically managed by MSERVE. You may still enter values when in{' '}
				<Link to='/settings' className='font-medium text-foreground underline underline-offset-4'>
					advanced mode
				</Link>{' '}
				to override mserve's automatic networking (not recommended).
			</div>
		</div>
	);
};

export const AdvancedModeDisclaimer = ({ user }: { user: UserData }) => {
	if (user.advanced_mode) {
		return (
			<div className='rounded-md border-2 border-warning bg-warning/10 font-semibold p-4 text-sm text-warning-foreground flex gap-3 items-center'>
				<Info className='text-warning-foreground size-8 shrink-0' />
				<div>
					You have{' '}
					<Link to='/settings' className='font-medium text-foreground underline underline-offset-4'>
						advanced mode
					</Link>{' '}
					enabled. Certain properties that may be dangerous to modify are now shown.
				</div>
			</div>
		);
	}

	return (
		<div className='rounded-md border-2 bg-muted font-semibold p-4 text-sm text-foreground flex gap-3 items-center'>
			<Info className='text-foreground size-8 shrink-0' />
			<div>
				Certain properties are hidden that you can only access when{' '}
				<Link to='/settings' className='font-medium text-foreground underline underline-offset-4'>
					advanced mode
				</Link>{' '}
				is turned on. (not recommended for inexperienced hosts)
			</div>
		</div>
	);
};

export const LoadingFileContents = () => (
	<div className='flex items-center gap-2 text-sm text-muted-foreground'>
		<Loader className='size-4 animate-spin' />
		<span>Loading file contents...</span>
	</div>
);

export const EditorError = ({ message }: { message: string | null }) =>
	message ? <p className='text-sm text-destructive'>{message}</p> : null;
