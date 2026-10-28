import * as TOML from '@iarna/toml';
import * as YAML from 'yaml';

import type { ManagedServerConfigFileDefinition } from '@/lib/server-config-files';

/**
 * Throws if `content` isn't valid for its format. Only validates: the text is
 * saved as typed, because re-serializing would drop every comment (and turn an
 * all-comment file like the default help.yml into `null`).
 */
export const validatePlainTextContent = (
	content: string,
	format: ManagedServerConfigFileDefinition['format'],
) => {
	switch (format) {
		case 'json':
			JSON.parse(content);
			return;
		case 'yaml':
			YAML.parse(content);
			return;
		case 'toml':
			TOML.parse(content);
			return;
		default:
			return;
	}
};
