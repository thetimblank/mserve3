import * as TOML from '@iarna/toml';
import { describe, expect, it } from 'vitest';
import { getManagedServerConfigFileDefinitions } from '@/lib/server-config-files';
import { inferJsonColumns, jsonColumnDefaultValue, validateJsonRecords } from './json-config';
import { parsePropertiesMap } from './properties-config';
import { validatePlainTextContent } from './text-validation';
import { createVelocityTomlContent, parseVelocityEditorState } from './toml-config';

describe('parsePropertiesMap', () => {
	it('reads lines the way Java Properties does instead of rejecting them', () => {
		const values = parsePropertiesMap(
			['#Minecraft server properties', 'motd=A: Minecraft Server', 'level-seed', 'pvp true', 'key = value'].join(
				'\n',
			),
		);

		expect(values.get('motd')).toBe('A: Minecraft Server');
		expect(values.get('level-seed')).toBe('');
		expect(values.get('pvp')).toBe('true');
		expect(values.get('key')).toBe('value');
	});

	it('joins a value continued with a trailing backslash', () => {
		const values = parsePropertiesMap(['motd=Line one \\', '   and two', 'pvp=true'].join('\n'));

		expect(values.get('motd')).toBe('Line one and two');
		expect(values.has('and')).toBe(false);
		expect(values.get('pvp')).toBe('true');
	});
});

describe('JSON list files', () => {
	it('gives new ops the server default level instead of 0', () => {
		const level = inferJsonColumns([], 'ops.json').find((column) => column.key === 'level');
		expect(level && jsonColumnDefaultValue(level)).toBe('4');
	});

	it('rejects whitelist rows the server would drop for a missing UUID', () => {
		expect(() => validateJsonRecords('whitelist.json', [{ uuid: '', name: 'Steve' }])).toThrow(/Row 1/);
		expect(() =>
			validateJsonRecords('whitelist.json', [{ uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'Notch' }]),
		).not.toThrow();
		expect(() => validateJsonRecords('banned-ips.json', [{ ip: '1.2.3.4' }])).not.toThrow();
		// Rows the user didn't touch aren't checked.
		expect(() => validateJsonRecords('whitelist.json', [{ name: 'Steve' }], () => false)).not.toThrow();
	});
});

describe('validatePlainTextContent', () => {
	it('accepts valid YAML (including an all-comment file) and rejects broken YAML', () => {
		expect(() => validatePlainTextContent('# only comments\n', 'yaml')).not.toThrow();
		expect(() => validatePlainTextContent('settings:\n  a: [1, 2\n', 'yaml')).toThrow();
	});
});

describe('createVelocityTomlContent', () => {
	const definition = getManagedServerConfigFileDefinitions('proxy', 'velocity').find(
		(entry) => entry.kind === 'velocity-toml',
	)!;
	const content = `# Velocity config
bind = "0.0.0.0:25565"
motd = "<#09add3>A Velocity Server"
online-mode = true

[servers]
# Backends
lobby = "127.0.0.1:30066"
factions = "127.0.0.1:30067"
try = ["lobby"]
`;

	it('drops a backend that was deleted from the servers field, and keeps comments', () => {
		const state = parseVelocityEditorState(content, definition);
		const servers = JSON.parse(state.values.servers) as Record<string, string>;
		delete servers.factions;

		const featuredKeySet = new Set(definition.featuredProperties.map((property) => property.key));
		const next = createVelocityTomlContent({
			content,
			root: state.root,
			values: { ...state.values, servers: JSON.stringify(servers) },
			advancedKeys: Object.keys(state.root).filter((key) => key !== 'servers' && !featuredKeySet.has(key)),
			featuredKeySet,
			definition,
		});

		expect(TOML.parse(next).servers).toEqual({ lobby: '127.0.0.1:30066', try: ['lobby'] });
		expect(next).toContain('# Velocity config');
		expect(next).toContain('# Backends');
	});
});
