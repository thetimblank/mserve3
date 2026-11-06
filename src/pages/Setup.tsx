import type * as React from 'react';
import { SlideshowPage, SlideshowProvider } from '@/components/slideshow';
import SlideRepeatSetup from './setup/SlideRepeatSetup';
import SlideInitialSetup from './setup/SlideInitialSetup';
import SlideChoosePath from './setup/SlideChoosePath';
import SlideTunnelAccount from './setup/SlideTunnelAccount';
import SlideTunnelServer from './setup/SlideTunnelServer';
import SlideForwardPrereq from './setup/SlideForwardPrereq';
import SlideRouter from './setup/SlideRouter';
import SlideFirewall from './setup/SlideFirewall';
import SlideAddress from './setup/SlideAddress';
import SlideStart from './setup/SlideStart';
import { SetupProvider, useSetup } from './setup/SetupContext';
import { resolveSetupSteps, type SetupStepId } from './setup/setup-steps';
import { useUser } from '@/data/user';

const STEP_SLIDES: Record<Exclude<SetupStepId, 'intro'>, React.FC> = {
	choose: SlideChoosePath,
	'tunnel-account': SlideTunnelAccount,
	'tunnel-server': SlideTunnelServer,
	'forward-prereq': SlideForwardPrereq,
	'forward-router': SlideRouter,
	'forward-firewall': SlideFirewall,
	'forward-address': SlideAddress,
	'forward-start': SlideStart,
};

/** The slides for the branch picked so far (intro + choice until a path is chosen). */
const SetupSlides: React.FC = () => {
	const { user } = useUser();
	const { data } = useSetup();

	const slides = resolveSetupSteps(data.path).map((step) => {
		if (step === 'intro') {
			return user.initial_setup_hosting_tutorial_completed ? (
				<SlideRepeatSetup key={step} />
			) : (
				<SlideInitialSetup key={step} />
			);
		}
		const Slide = STEP_SLIDES[step];
		return <Slide key={step} />;
	});

	return <SlideshowPage slides={slides} />;
};

const Setup: React.FC = () => (
	<SlideshowProvider>
		<SetupProvider>
			<SetupSlides />
		</SetupProvider>
	</SlideshowProvider>
);

export default Setup;
