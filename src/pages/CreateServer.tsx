import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCreateServer } from './create-server/CreateServerContext';
import SlideAutoRestart from './create-server/slides/SlideAutoRestart';
import SlideBackups from './create-server/slides/SlideBackups';
import SlideDirectory from './create-server/slides/SlideDirectory';
import SlideDone from './create-server/slides/SlideDone';
import SlideEula from './create-server/slides/SlideEula';
import SlideIntro from './create-server/slides/SlideIntro';
import SlideJarFile from './create-server/slides/SlideJarFile';
import SlideRam from './create-server/slides/SlideRam';
import SlideReview from './create-server/slides/SlideReview';
import { AnimatePresence } from 'motion/react';
import { m } from 'motion/react';

const CreateServerContent: React.FC = () => {
	const { slide, prevSlide, showBackButton, showStepIndicator, currentStep, totalSteps, error } =
		useCreateServer();
	const shouldTopAlignContent = slide === 2 || slide === 3;

	const slides = [
		<SlideIntro key='intro' />,
		<SlideDirectory key='directory' />,
		<SlideJarFile key='jar-file' />,
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

				{slides[slide]}

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
