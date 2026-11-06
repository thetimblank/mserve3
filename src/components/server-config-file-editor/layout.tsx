import { Link } from 'react-router-dom';
import { Info, Loader, RefreshCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useExperience } from '@/data/user';
import type { ManagedServerConfigFileDefinition } from '@/lib/server-config-files';

/** File actions above an editor. The file name is already the page title. */
export const EditorHeader = ({
	isDirty,
	onReload,
	disabled,
}: {
	isDirty: boolean;
	onReload: () => Promise<void> | void;
	disabled: boolean;
}) => (
	<div className='flex flex-wrap items-center justify-end gap-2'>
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
);

const ExperienceSettingsLink = () => (
	<Link to='/settings#behavior' className='font-medium text-foreground underline underline-offset-4'>
		Advanced experience level
	</Link>
);

export const NetworkingDisclaimer = ({ definition }: { definition: ManagedServerConfigFileDefinition }) => {
	const { isAdvanced } = useExperience();
	if (!definition.networkingDisclaimer || !isAdvanced) return null;

	return (
		<div className='rounded-md border-2 border-warning bg-warning/10 font-semibold p-4 text-sm text-warning-foreground flex gap-3 items-center'>
			<Info className='text-warning-foreground size-8 shrink-0' />
			<div>
				Server networking is automatically managed by MSERVE. Values entered here override mserve's
				automatic networking (not recommended).
			</div>
		</div>
	);
};

export const AdvancedModeDisclaimer = () => {
	const { isAdvanced } = useExperience();
	if (isAdvanced) {
		return (
			<div className='rounded-md border-2 border-warning bg-warning/10 font-semibold p-4 text-sm text-warning-foreground flex gap-3 items-center'>
				<Info className='text-warning-foreground size-8 shrink-0' />
				<div>
					You are using the <ExperienceSettingsLink />. Certain properties that may be dangerous to
					modify are now shown.
				</div>
			</div>
		);
	}

	return (
		<div className='rounded-md border-2 bg-muted font-semibold p-4 text-sm text-foreground flex gap-3 items-center'>
			<Info className='text-foreground size-8 shrink-0' />
			<div>
				Certain properties are hidden. Switch to the <ExperienceSettingsLink /> to edit them (not
				recommended for inexperienced hosts).
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
