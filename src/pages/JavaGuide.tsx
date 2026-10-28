import { SlideshowPage, SlideshowProvider } from '@/components/slideshow';
import Slide0 from './java-guide/Slide0';
import Slide1 from './java-guide/Slide1';
import Slide2 from './java-guide/Slide2';
import Slide3 from './java-guide/Slide3';
import Slide4 from './java-guide/Slide4';

const JavaGuide: React.FC = () => (
	<SlideshowProvider>
		<SlideshowPage
			slides={[
				<Slide0 key='intro' />,
				<Slide1 key='automatic' />,
				<Slide2 key='detected' />,
				<Slide3 key='install' />,
				<Slide4 key='done' />,
			]}
		/>
	</SlideshowProvider>
);

export default JavaGuide;
