import { detectJavaRuntimes, JavaRuntimeDetectionResult } from '@/lib/java-runtime-service';
import React, { createContext, useContext, useState } from 'react';

export interface State {
	error: string | null;
	is_loading: boolean;
	is_refreshing: boolean;
}
interface SlideContextType {
	state: State;
	runtime: JavaRuntimeDetectionResult | null;
	slide: number;
	nextSlide: () => void;
	prevSlide: () => void;
}

const SlideContext = createContext<SlideContextType | undefined>(undefined);

export const SlideProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [slide, setSlide] = useState(0);
	const [runtime, setRuntime] = useState<JavaRuntimeDetectionResult | null>(null);
	const [state, setState] = useState<State>({
		error: '',
		is_loading: false,
		is_refreshing: false,
	});

	const fetchRuntimes = React.useCallback(async (reason: 'initial' | 'refresh') => {
		if (reason === 'initial') {
			setState({ ...state, is_loading: true });
		} else {
			setState({ ...state, is_refreshing: true });
		}

		try {
			const result = await detectJavaRuntimes();
			setRuntime(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to detect Java runtimes.';
			setState({ ...state, error: message });
		} finally {
			setState({ ...state, is_loading: false });
			setState({ ...state, is_refreshing: false });
		}
	}, []);

	React.useEffect(() => {
		void fetchRuntimes('initial');
	}, [fetchRuntimes]);

	const nextSlide = () => setSlide((prev) => prev + 1);
	const prevSlide = () => setSlide((prev) => (prev > 0 ? prev - 1 : prev));

	return (
		<SlideContext.Provider value={{ runtime, state, slide, nextSlide, prevSlide }}>
			{children}
		</SlideContext.Provider>
	);
};

export const useSlide = () => {
	const context = useContext(SlideContext);
	if (!context) {
		throw new Error('useSlide must be used within a SlideProvider');
	}
	return context;
};
