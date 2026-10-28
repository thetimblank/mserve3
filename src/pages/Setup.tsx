import { SlideshowPage, SlideshowProvider } from '@/components/slideshow';
import SlideRepeatSetup from './setup/SlideRepeatSetup';
import SlideInitialSetup from './setup/SlideInitialSetup';
import Slide1 from './setup/Slide1';
import Slide2 from './setup/Slide2';
import Slide3 from './setup/Slide3';
import Slide4 from './setup/Slide4';
import { SetupProvider } from './setup/SetupContext';
import { useUser } from '@/data/user';

const Setup: React.FC = () => {
	const { user } = useUser();

	const slides = [
		user.initial_setup_hosting_tutorial_completed ? (
			<SlideRepeatSetup key='intro' />
		) : (
			<SlideInitialSetup key='intro' />
		),
		<Slide1 key='firewall' />,
		<Slide2 key='router' />,
		<Slide3 key='address' />,
		<Slide4 key='start' />,
	];

	return (
		<SlideshowProvider>
			<SetupProvider>
				<SlideshowPage slides={slides} />
			</SetupProvider>
		</SlideshowProvider>
	);
};

export default Setup;
