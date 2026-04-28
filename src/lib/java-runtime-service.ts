import { invoke } from '@tauri-apps/api/core';
import { chooseBestInstalledJava, type JavaRequirement } from './java-compatibility';

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

export const normalizeJavaExecutablePath = (value: string) => value.trim().replace(/\\/g, '/').toLowerCase();

export const findJavaRuntimeByExecutablePath = (
	executablePath: string | null | undefined,
	runtimes: JavaRuntimeInfo[],
) => {
	const trimmed = executablePath?.trim();
	if (!trimmed) return null;

	const normalized = normalizeJavaExecutablePath(trimmed);
	return (
		runtimes.find((runtime) => normalizeJavaExecutablePath(runtime.executablePath) === normalized) ?? null
	);
};

export const resolveJavaRuntimeForRequirement = (
	runtimes: JavaRuntimeInfo[],
	requirement: JavaRequirement,
) => {
	const installedMajors = runtimes.map((runtime) => runtime.majorVersion);
	const bestInstalledMajor = chooseBestInstalledJava(installedMajors, requirement);
	if (!bestInstalledMajor) return null;

	return runtimes.find((runtime) => runtime.majorVersion === bestInstalledMajor) ?? null;
};

export const getJavaRuntimeBadgeLabel = (runtime: JavaRuntimeInfo | null | undefined) =>
	runtime ? `Using Java ${runtime.majorVersion}` : null;

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
