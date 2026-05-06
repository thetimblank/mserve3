import { getEditableMotdValue, getStoredMotdValue } from '@/lib/motd-format';
import type {
	ManagedConfigPropertyDefinition,
	ManagedServerConfigFileDefinition,
} from '@/lib/server-config-files';

import type { PropertyValues } from './types';
import { parsePropertyNumber } from './utils';

export const parsePropertiesMap = (content: string) => {
	const values = new Map<string, string>();

	for (const rawLine of content.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
			continue;
		}

		const equalsIndex = rawLine.indexOf('=');
		const colonIndex = rawLine.indexOf(':');
		let separatorIndex = -1;

		if (equalsIndex >= 0 && colonIndex >= 0) {
			separatorIndex = Math.min(equalsIndex, colonIndex);
		} else {
			separatorIndex = equalsIndex >= 0 ? equalsIndex : colonIndex;
		}

		if (separatorIndex < 0) {
			throw new Error(`Invalid properties line: ${rawLine}`);
		}

		const key = rawLine.slice(0, separatorIndex).trim();
		const value = rawLine.slice(separatorIndex + 1).trim();
		if (!key) {
			throw new Error(`Invalid properties line: ${rawLine}`);
		}

		values.set(key, value);
	}

	return values;
};

export const serializePropertiesMap = (values: Map<string, string>, featuredKeys: string[]) => {
	const orderedKeys: string[] = [];
	const orderedKeySet = new Set<string>();

	for (const key of featuredKeys) {
		if (values.has(key) && !orderedKeySet.has(key)) {
			orderedKeys.push(key);
			orderedKeySet.add(key);
		}
	}

	for (const key of Array.from(values.keys()).sort((left, right) => left.localeCompare(right))) {
		if (orderedKeySet.has(key)) continue;
		orderedKeys.push(key);
		orderedKeySet.add(key);
	}

	return `${orderedKeys.map((key) => `${key}=${values.get(key) ?? ''}`).join('\n')}\n`;
};

export const parseServerPropertiesEditorState = (
	content: string,
	properties: ManagedConfigPropertyDefinition[],
) => {
	const sourceValues = parsePropertiesMap(content);

	for (const property of properties) {
		if (property.editor !== 'motd') continue;

		sourceValues.set(
			property.key,
			getEditableMotdValue(sourceValues.get(property.key) ?? '', property.motdFormat ?? 'legacy'),
		);
	}

	return {
		sourceValues,
		values: Object.fromEntries(sourceValues.entries()),
	};
};

export const createServerPropertiesContent = (
	sourceValues: Map<string, string>,
	values: PropertyValues,
	definition: ManagedServerConfigFileDefinition,
) => {
	const nextValues = new Map(sourceValues);

	for (const [key, value] of Object.entries(values)) {
		nextValues.set(key, value);
	}

	for (const property of definition.featuredProperties) {
		if (property.editor === 'motd') {
			nextValues.set(
				property.key,
				getStoredMotdValue(values[property.key] ?? '', property.motdFormat ?? 'legacy'),
			);
			continue;
		}

		const currentValue = values[property.key]?.trim() ?? '';

		if (property.type === 'number') {
			nextValues.set(property.key, parsePropertyNumber(property, currentValue));
			continue;
		}

		if (property.type === 'boolean') {
			nextValues.set(property.key, currentValue.toLowerCase() === 'true' ? 'true' : 'false');
			continue;
		}

		if (property.type === 'enum') {
			if (!property.options?.some((option) => option.value === currentValue)) {
				throw new Error(`${property.label} must be one of the supported options.`);
			}
			nextValues.set(property.key, currentValue);
			continue;
		}

		if (property.type === 'string') {
			nextValues.set(property.key, values[property.key] ?? '');
		}
	}

	return serializePropertiesMap(
		nextValues,
		definition.featuredProperties.map((property) => property.key),
	);
};
