import * as TOML from '@iarna/toml';

import { getEditableMotdValue, getStoredMotdValue } from '@/lib/motd-format';
import type {
	ManagedConfigPropertyDefinition,
	ManagedServerConfigFileDefinition,
} from '@/lib/server-config-files';

import type { PropertyValues, TomlRoot, TomlValueKind } from './types';
import {
	createPropertyValues,
	defaultValueToString,
	isRecord,
	parseLineList,
	parsePropertyNumber,
} from './utils';

export const parseTomlValue = (templateValue: unknown, value: string): unknown => {
	if (typeof templateValue === 'number') {
		const parsed = Number(value.trim());
		if (!Number.isFinite(parsed)) {
			throw new Error('Numeric values must contain a valid number.');
		}
		return parsed;
	}

	if (typeof templateValue === 'boolean') {
		return value.trim().toLowerCase() === 'true';
	}

	if (Array.isArray(templateValue)) {
		return parseLineList(value);
	}

	if (isRecord(templateValue)) {
		const trimmed = value.trim();
		if (!trimmed) return {};

		const parsed = JSON.parse(trimmed) as unknown;
		if (!isRecord(parsed)) {
			throw new Error('Advanced TOML object values must be valid JSON objects.');
		}
		return parsed;
	}

	return value;
};

export const inferTomlValueKind = (value: unknown): TomlValueKind => {
	if (typeof value === 'number') return 'number';
	if (typeof value === 'boolean') return 'boolean';
	if (Array.isArray(value)) return 'list';
	if (isRecord(value)) return 'json';
	return 'string';
};

export const tomlValueToString = (value: unknown): string => {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (Array.isArray(value)) return value.map((entry) => tomlValueToString(entry)).join('\n');
	if (isRecord(value)) return JSON.stringify(value, null, 2);
	return String(value);
};

const parseJsonTextarea = (property: ManagedConfigPropertyDefinition, input: string) => {
	const trimmed = input.trim();
	if (!trimmed) return {};

	const parsed = JSON.parse(trimmed) as unknown;
	if (!isRecord(parsed)) {
		throw new Error(`${property.label} must be a JSON object.`);
	}

	return parsed;
};

export const parseVelocityEditorState = (
	content: string,
	definition: ManagedServerConfigFileDefinition,
) => {
	const parsedRoot = TOML.parse(content) as TomlRoot;
	const serversTable = isRecord(parsedRoot.servers) ? parsedRoot.servers : {};
	const serverEntries: TomlRoot = { ...serversTable };
	delete serverEntries.try;

	const featuredKeySet = new Set(definition.featuredProperties.map((property) => property.key));
	const nextValues: PropertyValues = {};
	const nextRootKeys = Object.keys(parsedRoot).filter((key) => key !== 'servers');

	for (const property of definition.featuredProperties) {
		if (property.key === 'servers') {
			nextValues[property.key] = JSON.stringify(serverEntries, null, 2);
			continue;
		}

		if (property.key === 'try') {
			nextValues[property.key] = Array.isArray(serversTable.try)
				? serversTable.try.map((entry) => String(entry)).join('\n')
				: defaultValueToString(property.defaultValue);
			continue;
		}

		if (property.editor === 'motd') {
			nextValues[property.key] = getEditableMotdValue(
				String(parsedRoot[property.key] ?? defaultValueToString(property.defaultValue)),
				property.motdFormat ?? 'minimessage',
			);
			continue;
		}

		nextValues[property.key] = createPropertyValues([property], {
			[property.key]: parsedRoot[property.key],
		})[property.key];
	}

	for (const key of nextRootKeys) {
		if (featuredKeySet.has(key)) continue;
		nextValues[key] = tomlValueToString(parsedRoot[key]);
	}

	return { root: parsedRoot, values: nextValues };
};

export const createVelocityTomlContent = ({
	root,
	values,
	advancedKeys,
	featuredKeySet,
	definition,
}: {
	root: TomlRoot;
	values: PropertyValues;
	advancedKeys: string[];
	featuredKeySet: Set<string>;
	definition: ManagedServerConfigFileDefinition;
}) => {
	const nextRoot: TomlRoot = { ...root };
	const nextServers = isRecord(nextRoot.servers) ? { ...nextRoot.servers } : {};

	for (const property of definition.featuredProperties) {
		if (property.editor === 'motd') {
			nextRoot[property.key] = getStoredMotdValue(
				values[property.key] ?? '',
				property.motdFormat ?? 'minimessage',
			);
			continue;
		}

		const currentValue = values[property.key]?.trim() ?? '';

		if (property.type === 'number') {
			nextRoot[property.key] = Number.parseInt(parsePropertyNumber(property, currentValue), 10);
			continue;
		}

		if (property.type === 'boolean') {
			nextRoot[property.key] = currentValue.toLowerCase() === 'true';
			continue;
		}

		if (property.type === 'enum') {
			if (!property.options?.some((option) => option.value === currentValue)) {
				throw new Error(`${property.label} must be one of the supported options.`);
			}
			nextRoot[property.key] = currentValue;
			continue;
		}

		if (property.key === 'servers') {
			Object.assign(nextServers, parseJsonTextarea(property, currentValue));
			continue;
		}

		if (property.key === 'try') {
			nextServers.try = parseLineList(currentValue);
			continue;
		}

		nextRoot[property.key] = values[property.key] ?? '';
	}

	for (const key of advancedKeys) {
		if (featuredKeySet.has(key) || key === 'servers') continue;
		nextRoot[key] = parseTomlValue(root[key], values[key] ?? '');
	}

	nextRoot.servers = nextServers;
	return `${TOML.stringify(nextRoot as TOML.JsonMap).trimEnd()}\n`;
};
