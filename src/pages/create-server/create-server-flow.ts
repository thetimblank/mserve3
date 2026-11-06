import { isProxyProvider, PROVIDER_NAMES } from '@/lib/server-provider';
import type { Provider, ProviderName } from '@/lib/mserve-schema';

export const CREATE_SERVER_SLIDE_INDEX = {
	intro: 0,
	directory: 1,
	provider: 2,
	version: 3,
	ram: 4,
	autoRestart: 5,
	backups: 6,
	eula: 7,
	review: 8,
	done: 9,
} as const;

export type CreateServerSlideIndex =
	(typeof CREATE_SERVER_SLIDE_INDEX)[keyof typeof CREATE_SERVER_SLIDE_INDEX];

const DEFAULT_STEP_SLIDES = [
	CREATE_SERVER_SLIDE_INDEX.directory,
	CREATE_SERVER_SLIDE_INDEX.provider,
	CREATE_SERVER_SLIDE_INDEX.version,
	CREATE_SERVER_SLIDE_INDEX.ram,
	CREATE_SERVER_SLIDE_INDEX.autoRestart,
	CREATE_SERVER_SLIDE_INDEX.backups,
	CREATE_SERVER_SLIDE_INDEX.eula,
	CREATE_SERVER_SLIDE_INDEX.review,
] as const;

const PROXY_STEP_SLIDES = [
	CREATE_SERVER_SLIDE_INDEX.directory,
	CREATE_SERVER_SLIDE_INDEX.provider,
	CREATE_SERVER_SLIDE_INDEX.version,
	CREATE_SERVER_SLIDE_INDEX.ram,
	CREATE_SERVER_SLIDE_INDEX.autoRestart,
	CREATE_SERVER_SLIDE_INDEX.review,
] as const;

export const getCreateServerStepSlides = (provider?: Provider | null) =>
	isProxyProvider(provider) ? PROXY_STEP_SLIDES : DEFAULT_STEP_SLIDES;

const getCreateServerFlowSlides = (provider?: Provider | null) =>
	[
		CREATE_SERVER_SLIDE_INDEX.intro,
		...getCreateServerStepSlides(provider),
		CREATE_SERVER_SLIDE_INDEX.done,
	] as readonly CreateServerSlideIndex[];

export const getCreateServerVisibleSlide = (
	slide: number,
	provider?: Provider | null,
): CreateServerSlideIndex => {
	const flowSlides = getCreateServerFlowSlides(provider);
	if (flowSlides.includes(slide as CreateServerSlideIndex)) {
		return slide as CreateServerSlideIndex;
	}

	const nextVisibleSlide = flowSlides.find((candidate) => candidate > slide);
	if (nextVisibleSlide !== undefined) {
		return nextVisibleSlide;
	}

	for (let index = flowSlides.length - 1; index >= 0; index -= 1) {
		const candidate = flowSlides[index];
		if (candidate < slide) {
			return candidate;
		}
	}

	return CREATE_SERVER_SLIDE_INDEX.intro;
};

export const getCreateServerNextSlide = (
	slide: number,
	provider?: Provider | null,
): CreateServerSlideIndex => {
	const flowSlides = getCreateServerFlowSlides(provider);
	const visibleSlide = getCreateServerVisibleSlide(slide, provider);
	const visibleIndex = flowSlides.indexOf(visibleSlide);
	return flowSlides[Math.min(visibleIndex + 1, flowSlides.length - 1)];
};

export const getCreateServerPreviousSlide = (
	slide: number,
	provider?: Provider | null,
): CreateServerSlideIndex => {
	const flowSlides = getCreateServerFlowSlides(provider);
	const visibleSlide = getCreateServerVisibleSlide(slide, provider);
	const visibleIndex = flowSlides.indexOf(visibleSlide);
	return flowSlides[Math.max(visibleIndex - 1, 0)];
};

export const getCreateServerCurrentStep = (slide: number, provider?: Provider | null) => {
	const stepSlides = getCreateServerStepSlides(provider);
	const visibleSlide = getCreateServerVisibleSlide(slide, provider);
	const visibleIndex = stepSlides.findIndex((candidate) => candidate === visibleSlide);
	return visibleIndex >= 0 ? visibleIndex + 1 : 1;
};

/** What the user picked on the provider slide: a downloadable provider, or a modpack. */
export type ProviderChoice = { source: 'software'; provider: ProviderName } | { source: 'modpack' };

export const isSameProviderChoice = (left: ProviderChoice | null, right: ProviderChoice | null) => {
	if (!left || !right) return left === right;
	if (left.source !== right.source) return false;
	return left.source === 'modpack' || (right.source === 'software' && left.provider === right.provider);
};

/** Router state other pages pass to `/servers/new` to preselect the provider slide. */
export type CreateServerPreset = { source?: 'software'; provider: ProviderName } | { source: 'modpack' };

/**
 * Reads the wizard preset other pages pass through router state
 * (`navigate('/servers/new', { state: { provider: 'paper' } })`). Returns `null`
 * when there's nothing usable to preselect. Only wizard-selectable providers count.
 */
export const parseCreateServerPreset = (state: unknown): ProviderChoice | null => {
	if (!state || typeof state !== 'object') return null;
	const { provider, source } = state as { provider?: unknown; source?: unknown };

	if (source === 'modpack') return { source: 'modpack' };
	if (source !== undefined && source !== 'software') return null;

	if (typeof provider !== 'string') return null;
	const name = provider.trim().toLowerCase();
	const match = PROVIDER_NAMES.find((candidate) => candidate === name);
	return match ? { source: 'software', provider: match } : null;
};
