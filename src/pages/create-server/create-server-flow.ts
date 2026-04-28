import { isProxyProvider } from '@/lib/server-provider';
import type { Provider } from '@/lib/mserve-schema';

export const CREATE_SERVER_SLIDE_INDEX = {
	intro: 0,
	directory: 1,
	jarFile: 2,
	ram: 3,
	autoRestart: 4,
	backups: 5,
	eula: 6,
	review: 7,
	done: 8,
} as const;

export type CreateServerSlideIndex =
	(typeof CREATE_SERVER_SLIDE_INDEX)[keyof typeof CREATE_SERVER_SLIDE_INDEX];

const DEFAULT_STEP_SLIDES = [
	CREATE_SERVER_SLIDE_INDEX.directory,
	CREATE_SERVER_SLIDE_INDEX.jarFile,
	CREATE_SERVER_SLIDE_INDEX.ram,
	CREATE_SERVER_SLIDE_INDEX.autoRestart,
	CREATE_SERVER_SLIDE_INDEX.backups,
	CREATE_SERVER_SLIDE_INDEX.eula,
	CREATE_SERVER_SLIDE_INDEX.review,
] as const;

const PROXY_STEP_SLIDES = [
	CREATE_SERVER_SLIDE_INDEX.directory,
	CREATE_SERVER_SLIDE_INDEX.jarFile,
	CREATE_SERVER_SLIDE_INDEX.ram,
	CREATE_SERVER_SLIDE_INDEX.autoRestart,
	CREATE_SERVER_SLIDE_INDEX.review,
] as const;

export const getCreateServerStepSlides = (provider?: Provider | null) =>
	isProxyProvider(provider) ? PROXY_STEP_SLIDES : DEFAULT_STEP_SLIDES;

export const getCreateServerFlowSlides = (provider?: Provider | null) =>
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
