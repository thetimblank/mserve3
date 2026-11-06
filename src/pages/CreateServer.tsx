import * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useCreateServer } from './create-server/CreateServerContext';
import { CREATE_SERVER_SLIDE_INDEX, parseCreateServerPreset } from './create-server/create-server-flow';
import SlideAutoRestart from './create-server/slides/SlideAutoRestart';
import SlideBackups from './create-server/slides/SlideBackups';
import SlideDirectory from './create-server/slides/SlideDirectory';
import SlideDone from './create-server/slides/SlideDone';
import SlideEula from './create-server/slides/SlideEula';
import SlideIntro from './create-server/slides/SlideIntro';
import SlideProvider from './create-server/slides/SlideProvider';
import SlideRam from './create-server/slides/SlideRam';
import SlideReview from './create-server/slides/SlideReview';
import SlideVersion from './create-server/slides/SlideVersion';
import { AnimatePresence } from 'motion/react';
import { m } from 'motion/react';

const CreateServerContent: React.FC = () => {
	const {
		activeSlide,
		prevSlide,
		showBackButton,
		showStepIndicator,
		currentStep,
		totalSteps,
		error,
		chooseProvider,
		form,
		modpack,
	} = useCreateServer();
	const location = useLocation();
	const navigate = useNavigate();
	const shouldTopAlignContent =
		activeSlide === CREATE_SERVER_SLIDE_INDEX.version || activeSlide === CREATE_SERVER_SLIDE_INDEX.ram;

	// Other pages can preselect the provider slide through router state
	// (`{ provider?, source? }`). It's applied once, then cleared so a reload or
	// a later visit doesn't re-apply it. A draft that already has a jar or
	// modpack keeps it: the preset never throws away a download.
	const hasCommittedSource = form.file.trim() !== '' || modpack !== null;
	React.useEffect(() => {
		if (location.state == null) return;
		const preset = parseCreateServerPreset(location.state);
		if (preset && !hasCommittedSource) chooseProvider(preset);
		navigate(
			{ pathname: location.pathname, search: location.search, hash: location.hash },
			{ replace: true, state: null },
		);
	}, [
		chooseProvider,
		hasCommittedSource,
		location.hash,
		location.pathname,
		location.search,
		location.state,
		navigate,
	]);

	const slides = [
		<SlideIntro key='intro' />,
		<SlideDirectory key='directory' />,
		<SlideProvider key='provider' />,
		<SlideVersion key='version' />,
		<SlideRam key='ram' />,
		<SlideAutoRestart key='auto-restart' />,
		<SlideBackups key='backups' />,
		<SlideEula key='eula' />,
		<SlideReview key='review' />,
		<SlideDone key='done' />,
	];

	return (
		<main className='w-full h-full relative overflow-hidden'>
			{showBackButton && (
				<Button variant='ghost' className='absolute m-12 size-12' onClick={prevSlide}>
					<ArrowLeft className='size-10' />
				</Button>
			)}
			<div
				className={`h-full min-h-0 flex justify-center p-12 w-full overflow-y-auto app-scroll-area ${
					shouldTopAlignContent ? 'items-start' : 'items-center'
				}`}>
				{showStepIndicator && (
					<div className='absolute top-0 right-0 m-12 text-sm text-muted-foreground'>
						Step {currentStep} / {totalSteps}
					</div>
				)}

				{slides[activeSlide]}

				<AnimatePresence>
					{error && showStepIndicator && (
						<m.p
							initial={{ y: 10, opacity: 0 }}
							whileInView={{ y: 0, opacity: 1 }}
							transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
							className='absolute bottom-8 left-0 w-full text-center text-sm text-destructive'>
							{error}
						</m.p>
					)}
				</AnimatePresence>
			</div>
		</main>
	);
};

const CreateServerPage: React.FC = () => <CreateServerContent />;

export default CreateServerPage;
