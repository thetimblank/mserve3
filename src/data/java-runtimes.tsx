import React from 'react';
import { detectJavaRuntimes, type JavaRuntimeInfo } from '@/lib/java-runtime-service';

type JavaRuntimesContextValue = {
	runtimes: JavaRuntimeInfo[];
	/** Detection warnings (non-fatal). */
	warnings: string[];
	scannedCandidates: number;
	isLoading: boolean;
	error: string | null;
	/** Re-runs detection; resolves to the fresh list. */
	rescan: () => Promise<JavaRuntimeInfo[]>;
};

const JavaRuntimesContext = React.createContext<JavaRuntimesContextValue | undefined>(undefined);

/**
 * Detects installed Java runtimes once for the whole app and shares them. Every
 * Java picker, the start sites, and the start-failure fallback read from here so
 * detection isn't repeated per page and a single `rescan()` (e.g. after a
 * download) refreshes everyone.
 */
export const JavaRuntimesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [runtimes, setRuntimes] = React.useState<JavaRuntimeInfo[]>([]);
	const [warnings, setWarnings] = React.useState<string[]>([]);
	const [scannedCandidates, setScannedCandidates] = React.useState(0);
	const [isLoading, setIsLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);

	const rescan = React.useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const result = await detectJavaRuntimes();
			setRuntimes(result.runtimes);
			setWarnings(result.errors);
			setScannedCandidates(result.scannedCandidates);
			return result.runtimes;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to detect Java runtimes.';
			setError(message);
			setRuntimes([]);
			return [];
		} finally {
			setIsLoading(false);
		}
	}, []);

	React.useEffect(() => {
		void rescan();
	}, [rescan]);

	const value = React.useMemo<JavaRuntimesContextValue>(
		() => ({ runtimes, warnings, scannedCandidates, isLoading, error, rescan }),
		[runtimes, warnings, scannedCandidates, isLoading, error, rescan],
	);

	return <JavaRuntimesContext.Provider value={value}>{children}</JavaRuntimesContext.Provider>;
};

export const useJavaRuntimes = (): JavaRuntimesContextValue => {
	const context = React.useContext(JavaRuntimesContext);
	if (!context) {
		throw new Error('useJavaRuntimes must be used within a JavaRuntimesProvider');
	}
	return context;
};
