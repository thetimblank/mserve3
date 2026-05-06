import type {
	ManagedServerConfigFileDefinition,
} from '@/lib/server-config-files';

export type ServerConfigFileEditorProps = {
	serverDirectory: string;
	definition: ManagedServerConfigFileDefinition;
	disabled?: boolean;
	onSaved?: () => Promise<void> | void;
};

export type PropertyValues = Record<string, string>;
export type TomlRoot = Record<string, unknown>;
export type JsonRecord = Record<string, unknown>;

export type JsonRow = {
	id: string;
	values: PropertyValues;
};

export type JsonColumnKind = 'string' | 'number' | 'boolean' | 'json';

export type JsonColumn = {
	key: string;
	label: string;
	kind: JsonColumnKind;
};

export type TomlValueKind = 'string' | 'number' | 'boolean' | 'list' | 'json';
