import { describe, expect, it } from 'vitest';
import { resolveLatestJarRowIds, type JarVersionRow } from './jar-download-service';

const row = (overrides: Partial<JarVersionRow> & Pick<JarVersionRow, 'id'>): JarVersionRow => ({
	tab: 'plugin',
	providerId: 'paper',
	provider: 'Paper',
	providerDescription: '',
	version: overrides.id,
	minecraftVersion: overrides.id,
	stability: 'stable',
	...overrides,
});

describe('resolveLatestJarRowIds', () => {
	it('tags the first stable row of each provider', () => {
		const rows = [
			row({ id: 'paper-1.22-pre', stability: 'unstable' }),
			row({ id: 'paper-1.21.11' }),
			row({ id: 'paper-1.21.10' }),
			row({ id: 'folia-1.21.8', providerId: 'folia' }),
			row({ id: 'folia-1.21.6', providerId: 'folia' }),
		];
		expect(resolveLatestJarRowIds(rows)).toEqual(new Set(['paper-1.21.11', 'folia-1.21.8']));
	});

	it('treats vanilla releases as stable and skips snapshots', () => {
		const rows = [
			row({ id: 'snap', providerId: 'vanilla', tab: 'vanilla', stability: 'snapshot' }),
			row({ id: '1.21.11', providerId: 'vanilla', tab: 'vanilla', stability: 'release' }),
		];
		expect(resolveLatestJarRowIds(rows)).toEqual(new Set(['1.21.11']));
	});

	it('tags nothing when a provider has no stable rows', () => {
		expect(resolveLatestJarRowIds([row({ id: 'a', stability: 'unstable' })]).size).toBe(0);
	});
});
