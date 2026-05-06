import React from 'react';
import { toast } from 'sonner';

import { Textarea } from '@/components/ui/textarea';
import { useUser } from '@/data/user';

import { getManagedConfigToastId, readManagedConfigFile, writeManagedConfigFile } from './file-operations';
import { EditorError, EditorHeader, LoadingFileContents, NetworkingDisclaimer } from './layout';
import { normalizePlainTextContent } from './text-normalizers';
import type { ServerConfigFileEditorProps } from './types';
import { useUnsavedChangesToast } from './use-unsaved-changes-toast';
import { toErrorMessage } from './utils';

const PlainTextConfigFileEditor: React.FC<ServerConfigFileEditorProps> = ({
	serverDirectory,
	definition,
	disabled,
	onSaved,
}) => {
	const [content, setContent] = React.useState('');
	const [originalContent, setOriginalContent] = React.useState('');
	const [isLoading, setIsLoading] = React.useState(true);
	const [isSaving, setIsSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const { user } = useUser();

	const isLocked = Boolean(disabled || isLoading || isSaving);
	const isDirty = content !== originalContent;
	const toastId = React.useMemo(
		() => getManagedConfigToastId(serverDirectory, definition.fileName),
		[definition.fileName, serverDirectory],
	);

	const loadContent = React.useCallback(async () => {
		if (!serverDirectory.trim()) return;

		setIsLoading(true);
		setError(null);
		try {
			const result = await readManagedConfigFile(serverDirectory, definition.fileName);
			setContent(result.content);
			setOriginalContent(result.content);
		} catch (err) {
			setError(toErrorMessage(err, `Could not load ${definition.fileName}.`));
		} finally {
			setIsLoading(false);
		}
	}, [definition.fileName, serverDirectory]);

	React.useEffect(() => {
		void loadContent();
	}, [loadContent]);

	const handleReset = React.useCallback(() => {
		setContent(originalContent);
		setError(null);
	}, [originalContent]);

	const handleReload = React.useCallback(async () => {
		await loadContent();
	}, [loadContent]);

	const handleSave = React.useCallback(async () => {
		if (isLocked) return;

		setError(null);
		setIsSaving(true);
		try {
			const normalizedContent = normalizePlainTextContent(content, definition.format);
			const result = await writeManagedConfigFile(
				serverDirectory,
				definition.fileName,
				normalizedContent,
			);

			setContent(result.content);
			setOriginalContent(result.content);
			toast.success(`${definition.title} saved.`);
			await onSaved?.();
		} catch (err) {
			setError(toErrorMessage(err, `Could not save ${definition.fileName}.`));
		} finally {
			setIsSaving(false);
		}
	}, [content, definition.fileName, definition.format, definition.title, isLocked, onSaved, serverDirectory]);

	useUnsavedChangesToast({
		toastId,
		isDirty,
		isLocked,
		isSaving,
		onReset: handleReset,
		onSave: handleSave,
	});

	return (
		<div className='space-y-6'>
			<EditorHeader
				definition={definition}
				isDirty={isDirty}
				onReload={handleReload}
				disabled={isLocked}
			/>
			<NetworkingDisclaimer user={user} definition={definition} />
			{isLoading ? (
				<LoadingFileContents />
			) : (
				<Textarea
					className='min-h-120 font-mono text-sm'
					value={content}
					onChange={(event) => {
						setContent(event.target.value);
						setError(null);
					}}
					disabled={isLocked}
					spellCheck={false}
				/>
			)}
			<EditorError message={error} />
		</div>
	);
};

export default PlainTextConfigFileEditor;
