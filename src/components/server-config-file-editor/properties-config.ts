import { getEditableMotdValue, getStoredMotdValue } from '@/lib/motd-format';
import type {
	ManagedConfigPropertyDefinition,
	ManagedServerConfigFileDefinition,
} from '@/lib/server-config-files';

import type { PropertyValues } from './types';
import { parsePropertyNumber } from './utils';

const isPropertiesSpace = (char: string | undefined) => char === ' ' || char === '\t' || char === '\f';

/**
 * Parses `.properties` lines the way Java's `Properties.load` does (which is how
 * the server reads them): the key ends at the first unescaped `=`, `:` or
 * whitespace, so `key value` and a bare `key` (empty value) are valid too.
 */
/** A line ending in an odd number of backslashes continues on the next one. */
const continuesOnNextLine = (line: string) => (line.match(/\\+$/)?.[0].length ?? 0) % 2 === 1;

export const parsePropertiesMap = (content: string) => {
	const values = new Map<string, string>();
	const physicalLines = content.split(/\r?\n/);

	for (let index = 0; index < physicalLines.length; index += 1) {
		const rawLine = physicalLines[index];
		let line = rawLine.trimStart();
		if (!line || line.startsWith('#') || line.startsWith('!')) {
			continue;
		}
		while (continuesOnNextLine(line) && index + 1 < physicalLines.length) {
			index += 1;
			line = line.slice(0, -1) + physicalLines[index].trimStart();
		}

		let keyEnd = 0;
		while (keyEnd < line.length) {
			const char = line[keyEnd];
			if (char === '\\') {
				keyEnd += 2;
				continue;
			}
			if (char === '=' || char === ':' || isPropertiesSpace(char)) break;
			keyEnd += 1;
		}

		const key = line.slice(0, keyEnd);
		if (!key) {
			throw new Error(`Invalid properties line: ${rawLine}`);
		}

		let valueStart = keyEnd;
		while (isPropertiesSpace(line[valueStart])) valueStart += 1;
		if (line[valueStart] === '=' || line[valueStart] === ':') valueStart += 1;

		values.set(key, line.slice(valueStart).trim());
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
