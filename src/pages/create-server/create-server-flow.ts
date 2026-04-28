import type { ServerProvider } from '@/lib/server-provider';

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

const STEP_SLIDES_BY_PROVIDER: Partial<Record<ServerProvider, readonly CreateServerSlideIndex[]>> = {
	velocity: [
		CREATE_SERVER_SLIDE_INDEX.directory,
		CREATE_SERVER_SLIDE_INDEX.jarFile,
		CREATE_SERVER_SLIDE_INDEX.ram,
		CREATE_SERVER_SLIDE_INDEX.autoRestart,
		CREATE_SERVER_SLIDE_INDEX.review,
	],
};

export const getCreateServerStepSlides = (provider: ServerProvider) =>
	STEP_SLIDES_BY_PROVIDER[provider] ?? DEFAULT_STEP_SLIDES;

export const getCreateServerFlowSlides = (provider: ServerProvider) =>
	[
		CREATE_SERVER_SLIDE_INDEX.intro,
		...getCreateServerStepSlides(provider),
		CREATE_SERVER_SLIDE_INDEX.done,
	] as readonly CreateServerSlideIndex[];

export const getCreateServerVisibleSlide = (
	slide: number,
	provider: ServerProvider,
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

export const getCreateServerNextSlide = (slide: number, provider: ServerProvider): CreateServerSlideIndex => {
	const flowSlides = getCreateServerFlowSlides(provider);
	const visibleSlide = getCreateServerVisibleSlide(slide, provider);
	const visibleIndex = flowSlides.indexOf(visibleSlide);
	return flowSlides[Math.min(visibleIndex + 1, flowSlides.length - 1)];
};

export const getCreateServerPreviousSlide = (
	slide: number,
	provider: ServerProvider,
): CreateServerSlideIndex => {
	const flowSlides = getCreateServerFlowSlides(provider);
	const visibleSlide = getCreateServerVisibleSlide(slide, provider);
	const visibleIndex = flowSlides.indexOf(visibleSlide);
	return flowSlides[Math.max(visibleIndex - 1, 0)];
};

export const getCreateServerCurrentStep = (slide: number, provider: ServerProvider) => {
	const stepSlides = getCreateServerStepSlides(provider);
	const visibleSlide = getCreateServerVisibleSlide(slide, provider);
	const visibleIndex = stepSlides.indexOf(visibleSlide);
	return visibleIndex >= 0 ? visibleIndex + 1 : 1;
};
