import React from 'react';
import { toast } from 'sonner';

import { getErrorMessage } from '@/lib/utils';

import { getManagedConfigToastId, readManagedConfigFile, writeManagedConfigFile } from './file-operations';
import type { ServerConfigFileEditorProps } from './types';
import { useUnsavedChangesToast } from './use-unsaved-changes-toast';

type UseManagedConfigFileOptions = ServerConfigFileEditorProps & {
	/** Loads file content into the editor's state. Throw to report unreadable content. */
	applyContent: (content: string) => void;
	/** The text to write. Throw to report a validation error instead of saving. */
	buildContent: () => string;
	isDirty: boolean;
	/** Puts the editor's state back to what was last loaded. */
	resetValues: () => void;
};

/**
 * The file plumbing shared by every config-file editor: load on mount, reload,
 * save through the backend, reset, and the sticky "unsaved changes" toast.
 * Each editor only owns its parsed state.
 */
export const useManagedConfigFile = ({
	serverDirectory,
	definition,
	disabled,
	onSaved,
	applyContent,
	buildContent,
	isDirty,
	resetValues,
}: UseManagedConfigFileOptions) => {
	const [isLoading, setIsLoading] = React.useState(true);
	const [isSaving, setIsSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	// Latest callbacks, so editors don't have to memoize them to avoid reloads.
	const callbacksRef = React.useRef({ applyContent, buildContent, resetValues, onSaved });
	callbacksRef.current = { applyContent, buildContent, resetValues, onSaved };

	const isLocked = Boolean(disabled || isLoading || isSaving);
	const { fileName, title } = definition;
	const toastId = React.useMemo(
		() => getManagedConfigToastId(serverDirectory, fileName),
		[fileName, serverDirectory],
	);

	const reload = React.useCallback(async () => {
		if (!serverDirectory.trim()) return;

		setIsLoading(true);
		setError(null);
		try {
			const result = await readManagedConfigFile(serverDirectory, fileName);
			callbacksRef.current.applyContent(result.content);
		} catch (err) {
			setError(getErrorMessage(err, `Could not load ${fileName}.`));
		} finally {
			setIsLoading(false);
		}
	}, [fileName, serverDirectory]);

	React.useEffect(() => {
		void reload();
	}, [reload]);

	const reset = React.useCallback(() => {
		callbacksRef.current.resetValues();
		setError(null);
	}, []);

	const save = React.useCallback(async () => {
		if (isLocked) return;

		setError(null);
		setIsSaving(true);
		try {
			const content = callbacksRef.current.buildContent();
			const result = await writeManagedConfigFile(serverDirectory, fileName, content);
			callbacksRef.current.applyContent(result.content);
			toast.success(`${title} saved.`);
			await callbacksRef.current.onSaved?.();
		} catch (err) {
			setError(getErrorMessage(err, `Could not save ${fileName}.`));
		} finally {
			setIsSaving(false);
		}
	}, [fileName, isLocked, serverDirectory, title]);

	useUnsavedChangesToast({ toastId, isDirty, isLocked, isSaving, onReset: reset, onSave: save });

	return { isLoading, isLocked, error, setError, reload, reset, save };
};
