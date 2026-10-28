import React from 'react';

import { useUser } from '@/data/user';

import { AdvancedPropertiesSection } from './advanced-properties-section';
import { FeaturedPropertyFields } from './featured-property-fields';
import { AdvancedModeDisclaimer, EditorError, EditorHeader, NetworkingDisclaimer } from './layout';
import { createVelocityTomlContent, inferTomlValueKind, parseVelocityEditorState } from './toml-config';
import type { PropertyValues, ServerConfigFileEditorProps, TomlRoot } from './types';
import { useManagedConfigFile } from './use-managed-config-file';
import { sameStringRecord } from './utils';

const VelocityTomlEditor: React.FC<ServerConfigFileEditorProps> = (props) => {
	const { definition } = props;
	const { user } = useUser();
	const [values, setValues] = React.useState<PropertyValues>({});
	const [originalValues, setOriginalValues] = React.useState<PropertyValues>({});
	const [root, setRoot] = React.useState<TomlRoot>({});
	const [content, setContent] = React.useState('');

	const isDirty = React.useMemo(() => !sameStringRecord(values, originalValues), [originalValues, values]);
	const featuredKeySet = React.useMemo(
		() => new Set(definition.featuredProperties.map((property) => property.key)),
		[definition.featuredProperties],
	);
	const advancedTomlKeys = React.useMemo(
		() => Object.keys(root).filter((key) => key !== 'servers' && !featuredKeySet.has(key)),
		[featuredKeySet, root],
	);

	const { isLocked, error, setError, reload } = useManagedConfigFile({
		...props,
		isDirty,
		applyContent: (loaded) => {
			const nextState = parseVelocityEditorState(loaded, definition);
			setContent(loaded);
			setRoot(nextState.root);
			setValues(nextState.values);
			setOriginalValues(nextState.values);
		},
		buildContent: () =>
			createVelocityTomlContent({
				content,
				root,
				values,
				advancedKeys: advancedTomlKeys,
				featuredKeySet,
				definition,
			}),
		resetValues: () => setValues(originalValues),
	});

	const updateValue = React.useCallback(
		(key: string, nextValue: string) => {
			setValues((previous) => ({ ...previous, [key]: nextValue }));
			setError(null);
		},
		[setError],
	);

	return (
		<div className='space-y-8'>
			<EditorHeader definition={definition} isDirty={isDirty} onReload={reload} disabled={isLocked} />
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
					description='All non-featured velocity.toml settings stay editable here when advanced mode is on.'
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
