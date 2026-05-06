import * as TOML from '@iarna/toml';
import * as YAML from 'yaml';

import type { ManagedServerConfigFileDefinition } from '@/lib/server-config-files';

const normalizeJsonContent = (content: string) => `${JSON.stringify(JSON.parse(content), null, 2)}\n`;

const normalizeYamlContent = (content: string) => {
	const parsed = YAML.parse(content);
	return `${YAML.stringify(parsed).trimEnd()}\n`;
};

const normalizeTomlContent = (content: string) => `${TOML.stringify(TOML.parse(content)).trimEnd()}\n`;

export const normalizePlainTextContent = (
	content: string,
	format: ManagedServerConfigFileDefinition['format'],
) => {
	switch (format) {
		case 'json':
			return normalizeJsonContent(content);
		case 'yaml':
			return normalizeYamlContent(content);
		case 'toml':
			return normalizeTomlContent(content);
		default:
			return content;
	}
};
