import React from 'react';
import { toast } from 'sonner';

import { useUser } from '@/data/user';

import { AdvancedPropertiesSection } from './advanced-properties-section';
import { FeaturedPropertyFields } from './featured-property-fields';
import { getManagedConfigToastId, readManagedConfigFile, writeManagedConfigFile } from './file-operations';
import { AdvancedModeDisclaimer, EditorError, EditorHeader, NetworkingDisclaimer } from './layout';
import { createVelocityTomlContent, inferTomlValueKind, parseVelocityEditorState } from './toml-config';
import type { PropertyValues, ServerConfigFileEditorProps, TomlRoot } from './types';
import { useUnsavedChangesToast } from './use-unsaved-changes-toast';
import { sameStringRecord, toErrorMessage } from './utils';

const VelocityTomlEditor: React.FC<ServerConfigFileEditorProps> = ({
	serverDirectory,
	definition,
	disabled,
	onSaved,
}) => {
	const { user } = useUser();
	const [values, setValues] = React.useState<PropertyValues>({});
	const [originalValues, setOriginalValues] = React.useState<PropertyValues>({});
	const [root, setRoot] = React.useState<TomlRoot>({});
	const [isLoading, setIsLoading] = React.useState(true);
	const [isSaving, setIsSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const isLocked = Boolean(disabled || isLoading || isSaving);
	const isDirty = React.useMemo(() => !sameStringRecord(values, originalValues), [originalValues, values]);
	const featuredKeySet = React.useMemo(
		() => new Set(definition.featuredProperties.map((property) => property.key)),
		[definition.featuredProperties],
	);
	const advancedTomlKeys = React.useMemo(
		() => Object.keys(root).filter((key) => key !== 'servers' && !featuredKeySet.has(key)),
		[featuredKeySet, root],
	);
	const toastId = React.useMemo(
		() => getManagedConfigToastId(serverDirectory, definition.fileName),
		[definition.fileName, serverDirectory],
	);

	const applyContent = React.useCallback(
		(content: string) => {
			const nextState = parseVelocityEditorState(content, definition);
			setRoot(nextState.root);
			setValues(nextState.values);
			setOriginalValues(nextState.values);
		},
		[definition],
	);

	const loadContent = React.useCallback(async () => {
		if (!serverDirectory.trim()) return;

		setIsLoading(true);
		setError(null);
		try {
			const result = await readManagedConfigFile(serverDirectory, definition.fileName);
			applyContent(result.content);
		} catch (err) {
			setError(toErrorMessage(err, `Could not load ${definition.fileName}.`));
		} finally {
			setIsLoading(false);
		}
	}, [applyContent, definition.fileName, serverDirectory]);

	React.useEffect(() => {
		void loadContent();
	}, [loadContent]);

	const handleReset = React.useCallback(() => {
		setValues(originalValues);
		setError(null);
	}, [originalValues]);

	const handleReload = React.useCallback(async () => {
		await loadContent();
	}, [loadContent]);

	const updateValue = React.useCallback((key: string, nextValue: string) => {
		setValues((previous) => ({ ...previous, [key]: nextValue }));
		setError(null);
	}, []);

	const handleSave = React.useCallback(async () => {
		if (isLocked) return;

		setError(null);
		setIsSaving(true);
		try {
			const normalizedContent = createVelocityTomlContent({
				root,
				values,
				advancedKeys: advancedTomlKeys,
				featuredKeySet,
				definition,
			});
			const result = await writeManagedConfigFile(serverDirectory, definition.fileName, normalizedContent);

			applyContent(result.content);
			toast.success(`${definition.title} saved.`);
			await onSaved?.();
		} catch (err) {
			setError(toErrorMessage(err, `Could not save ${definition.fileName}.`));
		} finally {
			setIsSaving(false);
		}
	}, [
		advancedTomlKeys,
		applyContent,
		definition,
		featuredKeySet,
		isLocked,
		onSaved,
		root,
		serverDirectory,
		values,
	]);

	useUnsavedChangesToast({
		toastId,
		isDirty,
		isLocked,
		isSaving,
		onReset: handleReset,
		onSave: handleSave,
	});

	return (
		<div className='space-y-8'>
			<EditorHeader
				definition={definition}
				isDirty={isDirty}
				onReload={handleReload}
				disabled={isLocked}
			/>
			<NetworkingDisclaimer user={user} definition={definition} />
			<AdvancedModeDisclaimer user={user} />
			<FeaturedPropertyFields
				properties={definition.featuredProperties}
				values={values}
				defaultMotdFormat='minimessage'
				advancedMode={user.advanced_mode}
				disabled={isLocked}
				onChange={updateValue}
			/>
			{user.advanced_mode && (
				<AdvancedPropertiesSection
					fileName={definition.fileName}
					keys={advancedTomlKeys}
					values={values}
					description='All non-featured server.properties entries stay editable here when advanced mode is on.'
					disabled={isLocked}
					getKind={(key) => inferTomlValueKind(root[key])}
					onChange={updateValue}
				/>
			)}
			<EditorError message={error} />
		</div>
	);
};

export default VelocityTomlEditor;
