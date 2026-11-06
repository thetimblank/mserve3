import React from 'react';

import { useExperience } from '@/data/user';

import { AdvancedPropertiesSection } from './advanced-properties-section';
import { FeaturedPropertyFields } from './featured-property-fields';
import { AdvancedModeDisclaimer, EditorError, EditorHeader, NetworkingDisclaimer } from './layout';
import { createServerPropertiesContent, parseServerPropertiesEditorState } from './properties-config';
import type { PropertyValues, ServerConfigFileEditorProps } from './types';
import { useManagedConfigFile } from './use-managed-config-file';
import { sameStringRecord } from './utils';

const ServerPropertiesFileEditor: React.FC<ServerConfigFileEditorProps> = (props) => {
	const { definition } = props;
	const { isAdvanced } = useExperience();
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
			<EditorHeader isDirty={isDirty} onReload={reload} disabled={isLocked} />
			<NetworkingDisclaimer definition={definition} />
			<AdvancedModeDisclaimer />
			<FeaturedPropertyFields
				properties={definition.featuredProperties}
				values={values}
				defaultMotdFormat='legacy'
				advancedMode={isAdvanced}
				disabled={isLocked}
				onChange={updateValue}
			/>
			{isAdvanced && (
				<AdvancedPropertiesSection
					fileName={definition.fileName}
					keys={advancedPropertyKeys}
					values={values}
					description='All non-featured server.properties entries stay editable here at the Advanced experience level.'
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
