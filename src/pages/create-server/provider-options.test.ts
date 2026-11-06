import { describe, expect, it } from 'vitest';
import { getProviderDescriptors } from '@/lib/server-provider';
import { GOAL_OPTIONS, PROVIDER_GRID_OPTIONS, type ProviderOption } from './provider-options';

const softwareProviders = (options: ProviderOption[]) =>
	options.flatMap((option) => (option.choice.source === 'software' ? [option.choice.provider] : []));

describe('provider slide options', () => {
	it('maps the beginner goals to their providers', () => {
		expect(GOAL_OPTIONS.map((option) => option.choice)).toEqual([
			{ source: 'software', provider: 'vanilla' },
			{ source: 'software', provider: 'paper' },
			{ source: 'software', provider: 'fabric' },
			{ source: 'modpack' },
			{ source: 'software', provider: 'velocity' },
		]);
	});

	it('offers every selectable provider plus modpacks in the grid', () => {
		expect(softwareProviders(PROVIDER_GRID_OPTIONS)).toEqual([
			'paper',
			'purpur',
			'folia',
			'vanilla',
			'fabric',
			'velocity',
			'bungeecord',
		]);
		expect(PROVIDER_GRID_OPTIONS[PROVIDER_GRID_OPTIONS.length - 1].choice).toEqual({ source: 'modpack' });
	});

	it('never offers detection-only providers', () => {
		const offered = new Set([...softwareProviders(GOAL_OPTIONS), ...softwareProviders(PROVIDER_GRID_OPTIONS)]);
		for (const descriptor of getProviderDescriptors()) {
			if (!descriptor.selectable) expect(offered.has(descriptor.name)).toBe(false);
		}
	});

	it('gives every provider descriptor an icon', () => {
		for (const descriptor of getProviderDescriptors()) {
			expect(descriptor.icon).toBeTruthy();
		}
	});
});
