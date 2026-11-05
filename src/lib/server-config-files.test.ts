import { describe, expect, it } from 'vitest';
import { getManagedServerConfigFileDefinitions, isConfigFileVisibleAtLevel } from './server-config-files';

const visibleKinds = (level: 'beginner' | 'standard' | 'advanced', providerKind: 'plugin' | 'proxy') =>
	getManagedServerConfigFileDefinitions(providerKind, providerKind === 'proxy' ? 'velocity' : 'paper')
		.filter((definition) => isConfigFileVisibleAtLevel(definition, level))
		.map((definition) => definition.kind);

describe('isConfigFileVisibleAtLevel', () => {
	it('gives beginners only the main config file', () => {
		expect(visibleKinds('beginner', 'plugin')).toEqual(['server-properties']);
		expect(visibleKinds('beginner', 'proxy')).toEqual(['velocity-toml']);
	});

	it('adds the non-YAML files at standard', () => {
		const kinds = visibleKinds('standard', 'plugin');
		expect(kinds).toContain('server-properties');
		expect(kinds).toContain('whitelist-json');
		expect(kinds).not.toContain('bukkit-yml');
		expect(visibleKinds('standard', 'proxy')).toContain('velocity-toml');
	});

	it('adds the YAML editors at advanced', () => {
		expect(visibleKinds('advanced', 'plugin')).toContain('bukkit-yml');
	});
});
