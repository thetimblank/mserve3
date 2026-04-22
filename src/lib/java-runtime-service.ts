import { invoke } from '@tauri-apps/api/core';

export type JavaRuntimeSource = 'path' | 'java_home' | 'common_install_dir' | string;

export type JavaRuntimeInfo = {
	executablePath: string;
	majorVersion: number;
	version: string;
	vendor: string;
	source: JavaRuntimeSource;
};

export type JavaRuntimeDetectionResult = {
	runtimes: JavaRuntimeInfo[];
	errors: string[];
	scannedCandidates: number;
};

export const detectJavaRuntimes = () =>
	invoke<JavaRuntimeDetectionResult>('detect_java_runtimes').then((result) => ({
		runtimes: result.runtimes
			.map((runtime) => ({
				...runtime,
				executablePath: runtime.executablePath.trim(),
				version: runtime.version.trim(),
				vendor: runtime.vendor.trim() || 'Unknown',
				source: runtime.source,
			}))
			.filter((runtime) => runtime.executablePath.length > 0)
			.sort((left, right) =>
				right.majorVersion === left.majorVersion
					? left.executablePath.localeCompare(right.executablePath)
					: right.majorVersion - left.majorVersion,
			),
		errors: result.errors,
		scannedCandidates: Math.max(0, Number(result.scannedCandidates) || 0),
	}));
