import { describe, expect, it } from 'vitest';
import { createProvider } from '@/lib/server-provider';
import {
	CREATE_SERVER_SLIDE_INDEX as SLIDE,
	createServerNeedsEula,
	getCreateServerCurrentStep,
	getCreateServerNextSlide,
	getCreateServerPreviousSlide,
	getCreateServerStepSlides,
	isSameProviderChoice,
	parseCreateServerPreset,
} from './create-server-flow';

describe('create server flow', () => {
	it('walks directory, provider, version, then ram', () => {
		expect(getCreateServerNextSlide(SLIDE.directory, null)).toBe(SLIDE.provider);
		expect(getCreateServerNextSlide(SLIDE.provider, null)).toBe(SLIDE.version);
		expect(getCreateServerNextSlide(SLIDE.version, null)).toBe(SLIDE.ram);
		expect(getCreateServerPreviousSlide(SLIDE.version, null)).toBe(SLIDE.provider);
	});

	it('counts provider and version as separate steps', () => {
		expect(getCreateServerStepSlides(null)).toHaveLength(7);
		expect(getCreateServerCurrentStep(SLIDE.provider, null)).toBe(2);
		expect(getCreateServerCurrentStep(SLIDE.version, null)).toBe(3);
	});

	it('goes from backups straight to review (the EULA is a checkbox there)', () => {
		expect(getCreateServerNextSlide(SLIDE.backups, null)).toBe(SLIDE.review);
		expect(getCreateServerPreviousSlide(SLIDE.review, null)).toBe(SLIDE.backups);
		expect(getCreateServerNextSlide(SLIDE.review, null)).toBe(SLIDE.done);
	});

	it('skips backups for proxies', () => {
		const velocity = createProvider('velocity');
		expect(getCreateServerStepSlides(velocity)).toHaveLength(6);
		expect(getCreateServerNextSlide(SLIDE.autoRestart, velocity)).toBe(SLIDE.review);
		expect(getCreateServerPreviousSlide(SLIDE.review, velocity)).toBe(SLIDE.autoRestart);
	});
});

describe('createServerNeedsEula', () => {
	it('asks for the EULA unless the server is a proxy', () => {
		expect(createServerNeedsEula(createProvider('paper'))).toBe(true);
		expect(createServerNeedsEula(createProvider('vanilla'))).toBe(true);
		// A modpack has no provider until it installs.
		expect(createServerNeedsEula(null)).toBe(true);
		expect(createServerNeedsEula(createProvider('velocity'))).toBe(false);
		expect(createServerNeedsEula(createProvider('bungeecord'))).toBe(false);
	});
});

describe('parseCreateServerPreset', () => {
	it('preselects a wizard-selectable provider', () => {
		expect(parseCreateServerPreset({ provider: 'paper' })).toEqual({ source: 'software', provider: 'paper' });
		expect(parseCreateServerPreset({ provider: ' Velocity ', source: 'software' })).toEqual({
			source: 'software',
			provider: 'velocity',
		});
	});

	it('preselects modpacks', () => {
		expect(parseCreateServerPreset({ source: 'modpack' })).toEqual({ source: 'modpack' });
	});

	it('ignores detection-only providers, unknown sources, and junk', () => {
		expect(parseCreateServerPreset({ provider: 'forge' })).toBeNull();
		expect(parseCreateServerPreset({ provider: 'spigot' })).toBeNull();
		expect(parseCreateServerPreset({ provider: 'waterfall' })).toBeNull();
		expect(parseCreateServerPreset({ provider: 'paper', source: 'jar' })).toBeNull();
		expect(parseCreateServerPreset({ source: 'software' })).toBeNull();
		expect(parseCreateServerPreset(null)).toBeNull();
		expect(parseCreateServerPreset('paper')).toBeNull();
	});
});

describe('isSameProviderChoice', () => {
	it('compares source and provider', () => {
		expect(isSameProviderChoice({ source: 'modpack' }, { source: 'modpack' })).toBe(true);
		expect(
			isSameProviderChoice({ source: 'software', provider: 'paper' }, { source: 'software', provider: 'paper' }),
		).toBe(true);
		expect(
			isSameProviderChoice({ source: 'software', provider: 'paper' }, { source: 'software', provider: 'folia' }),
		).toBe(false);
		expect(isSameProviderChoice({ source: 'software', provider: 'paper' }, { source: 'modpack' })).toBe(false);
		expect(isSameProviderChoice(null, { source: 'modpack' })).toBe(false);
	});
});
