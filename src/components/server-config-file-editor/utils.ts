import type { ManagedConfigPropertyDefinition } from '@/lib/server-config-files';

import type { PropertyValues } from './types';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const makeRowId = () =>
	`json-row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const prettifyKey = (key: string) =>
	key
		.split(/[-_.]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');

export const sameStringRecord = (left: PropertyValues, right: PropertyValues) => {
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) return false;

	for (const key of leftKeys) {
		if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
		if (left[key] !== right[key]) return false;
	}

	return true;
};

export const stringifyStructuredValue = (value: unknown): string => {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (Array.isArray(value)) return value.map((entry) => stringifyStructuredValue(entry)).join('\n');
	if (isRecord(value)) return JSON.stringify(value, null, 2);
	return String(value);
};

export const toErrorMessage = (err: unknown, fallback: string) =>
	err instanceof Error ? err.message : fallback;

export const defaultValueToString = (value: ManagedConfigPropertyDefinition['defaultValue']): string =>
	stringifyStructuredValue(value);

export const createPropertyValues = (
	properties: ManagedConfigPropertyDefinition[],
	rawValues: Record<string, unknown>,
): PropertyValues => {
	const nextValues: PropertyValues = {};

	for (const property of properties) {
		const rawValue = rawValues[property.key];
		if (typeof rawValue === 'string') {
			nextValues[property.key] = rawValue;
			continue;
		}

		if (typeof rawValue === 'number') {
			nextValues[property.key] = String(rawValue);
			continue;
		}

		if (typeof rawValue === 'boolean') {
			nextValues[property.key] = rawValue ? 'true' : 'false';
			continue;
		}

		if (Array.isArray(rawValue)) {
			nextValues[property.key] = rawValue.map((entry) => String(entry)).join('\n');
			continue;
		}

		if (isRecord(rawValue)) {
			nextValues[property.key] = JSON.stringify(rawValue, null, 2);
			continue;
		}

		nextValues[property.key] = defaultValueToString(property.defaultValue);
	}

	return nextValues;
};

export const parsePropertyNumber = (property: ManagedConfigPropertyDefinition, value: string) => {
	const parsed = Number(value.trim());
	if (!Number.isInteger(parsed)) {
		throw new Error(`${property.label} must be a whole number.`);
	}

	if (property.key === 'server-port' && (parsed < 1 || parsed > 65535)) {
		throw new Error('Server port must be between 1 and 65535.');
	}

	if (property.key === 'spawn-protection' && parsed < 0) {
		throw new Error('Spawn protection must be 0 or greater.');
	}

	if (parsed < 0) {
		throw new Error(`${property.label} must be 0 or greater.`);
	}

	return String(parsed);
};

export const parseLineList = (input: string) =>
	input
		.split(/\r?\n/)
		.map((entry) => entry.trim())
		.filter(Boolean);
