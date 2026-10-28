import React from 'react';

import { useUser } from '@/data/user';

import { AdvancedPropertiesSection } from './advanced-properties-section';
import { FeaturedPropertyFields } from './featured-property-fields';
import { AdvancedModeDisclaimer, EditorError, EditorHeader, NetworkingDisclaimer } from './layout';
import { createServerPropertiesContent, parseServerPropertiesEditorState } from './properties-config';
import type { PropertyValues, ServerConfigFileEditorProps } from './types';
import { useManagedConfigFile } from './use-managed-config-file';
import { sameStringRecord } from './utils';

const ServerPropertiesFileEditor: React.FC<ServerConfigFileEditorProps> = (props) => {
	const { definition } = props;
	const { user } = useUser();
	const [values, setValues] = React.useState<PropertyValues>({});
	const [originalValues, setOriginalValues] = React.useState<PropertyValues>({});
	const [sourceValues, setSourceValues] = React.useState<Map<string, string>>(new Map());

	const isDirty = React.useMemo(() => !sameStringRecord(values, originalValues), [originalValues, values]);
	const featuredKeySet = React.useMemo(
		() => new Set(definition.featuredProperties.map((property) => property.key)),
		[definition.featuredProperties],
	);
	const advancedPropertyKeys = React.useMemo(
		() => Array.from(sourceValues.keys()).filter((key) => !featuredKeySet.has(key)),
		[featuredKeySet, sourceValues],
	);

	const { isLocked, error, setError, reload } = useManagedConfigFile({
		...props,
		isDirty,
		applyContent: (content) => {
			const nextState = parseServerPropertiesEditorState(content, definition.featuredProperties);
			setSourceValues(nextState.sourceValues);
			setValues(nextState.values);
			setOriginalValues(nextState.values);
		},
		buildContent: () => createServerPropertiesContent(sourceValues, values, definition),
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
				defaultMotdFormat='legacy'
				advancedMode={user.advanced_mode}
				disabled={isLocked}
				onChange={updateValue}
			/>
			{user.advanced_mode && (
				<AdvancedPropertiesSection
					fileName={definition.fileName}
					keys={advancedPropertyKeys}
					values={values}
					description='All non-featured server.properties entries stay editable here when advanced mode is on.'
					disabled={isLocked}
					getKind={(_, value) => (value.includes('\n') || value.length > 120 ? 'multiline' : 'string')}
					onChange={updateValue}
				/>
			)}
			<EditorError message={error} />
		</div>
	);
};

export default ServerPropertiesFileEditor;
