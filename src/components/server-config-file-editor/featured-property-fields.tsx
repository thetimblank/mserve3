import MotdEditor from '@/components/motd-editor';
import type { MotdFormat } from '@/lib/motd-format';
import type { ManagedConfigPropertyDefinition } from '@/lib/server-config-files';

import type { PropertyValues } from './types';
import PropertyField from './property-field';

export const FeaturedPropertyFields = ({
	properties,
	values,
	defaultMotdFormat,
	advancedMode,
	disabled,
	onChange,
}: {
	properties: ManagedConfigPropertyDefinition[];
	values: PropertyValues;
	defaultMotdFormat: MotdFormat;
	advancedMode: boolean;
	disabled: boolean;
	onChange: (key: string, nextValue: string) => void;
}) => (
	<>
		{properties.map((property) =>
			property.editor === 'motd' ? (
				<MotdEditor
					key={property.key}
					label={property.label}
					description={property.description}
					value={values[property.key] ?? ''}
					onChange={(nextValue) => onChange(property.key, nextValue)}
					format={property.motdFormat ?? defaultMotdFormat}
					advancedMode={advancedMode}
					disabled={disabled}
				/>
			) : (
				<PropertyField
					key={property.key}
					property={property}
					value={values[property.key] ?? ''}
					onChange={(nextValue) => onChange(property.key, nextValue)}
					disabled={disabled}
				/>
			),
		)}
	</>
);
