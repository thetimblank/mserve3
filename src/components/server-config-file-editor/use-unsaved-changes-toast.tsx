import React from 'react';
import { Loader, Save, Trash } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

const UNSAVED_TOAST_STYLE = {
	'--width': 'min(32rem, calc(100vw - 2rem))',
} as React.CSSProperties;

export const useUnsavedChangesToast = ({
	toastId,
	isDirty,
	isLocked,
	isSaving,
	onReset,
	onSave,
}: {
	toastId: string;
	isDirty: boolean;
	isLocked: boolean;
	isSaving: boolean;
	onReset: () => void;
	onSave: () => Promise<void>;
}) => {
	React.useEffect(() => {
		if (isLocked || !isDirty) {
			toast.dismiss(toastId);
			return;
		}

		toast('You have unsaved changes', {
			id: toastId,
			duration: Number.POSITIVE_INFINITY,
			dismissible: false,
			style: UNSAVED_TOAST_STYLE,
			action: (
				<div className='ml-auto flex items-center gap-2'>
					<Button type='button' variant='destructive-secondary' onClick={onReset}>
						<Trash className='size-4' /> Reset
					</Button>
					<Button type='button' onClick={() => void onSave()}>
						{isSaving ? <Loader className='size-4 animate-spin' /> : <Save className='size-4' />}
						{isSaving ? 'Saving...' : 'Save file'}
					</Button>
				</div>
			),
		});
	}, [isDirty, isLocked, isSaving, onReset, onSave, toastId]);
};
