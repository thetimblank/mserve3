import React from 'react';

import { Textarea } from '@/components/ui/textarea';
import { useUser } from '@/data/user';

import { EditorError, EditorHeader, LoadingFileContents, NetworkingDisclaimer } from './layout';
import { validatePlainTextContent } from './text-validation';
import type { ServerConfigFileEditorProps } from './types';
import { useManagedConfigFile } from './use-managed-config-file';

const PlainTextConfigFileEditor: React.FC<ServerConfigFileEditorProps> = (props) => {
	const { definition } = props;
	const [content, setContent] = React.useState('');
	const [originalContent, setOriginalContent] = React.useState('');
	const { user } = useUser();

	const isDirty = content !== originalContent;
	const { isLoading, isLocked, error, setError, reload } = useManagedConfigFile({
		...props,
		isDirty,
		applyContent: (loaded) => {
			setContent(loaded);
			setOriginalContent(loaded);
		},
		buildContent: () => {
			validatePlainTextContent(content, definition.format);
			return content;
		},
		resetValues: () => setContent(originalContent),
	});

	return (
		<div className='space-y-6'>
			<EditorHeader definition={definition} isDirty={isDirty} onReload={reload} disabled={isLocked} />
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
