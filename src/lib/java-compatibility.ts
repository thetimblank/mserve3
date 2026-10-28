import { resolveProvider } from '@/lib/server-provider';

type JavaCompatibilityConfidence = 'high' | 'medium';

export type JavaCompatibilityStatus = 'compatible' | 'needs-upgrade' | 'unknown';

export type JavaRequirement = {
	minimumMajor: number;
	recommendedMajor: number;
	confidence: JavaCompatibilityConfidence;
	summary: string;
	notes: string[];
};

type ParsedMinecraftVersion = {
	/** 1 for the legacy `1.x` scheme; the year (>= 26) for the modern scheme. */
	major: number;
	minor: number;
	patch: number | null;
};

const parseMinecraftVersion = (version?: string | null): ParsedMinecraftVersion | null => {
	if (!version) return null;
	const normalized = version.trim().toLowerCase();
	if (!normalized) return null;

	// Modern year-based snapshots: 26w03a. Checked before the legacy scheme so a
	// year like `26` isn't mistaken for a `1.x` release.
	const snapshot = normalized.match(/\b(\d{2})w\d{2}[a-z]\b/);
	if (snapshot) {
		const year = Number(snapshot[1]);
		if (Number.isInteger(year) && year >= 26) {
			return { major: year, minor: 0, patch: null };
		}
	}

	// Modern year-based releases: 26, 26.1, 26.1.2. Must run before the legacy
	// scheme because the legacy `\b1\.` pattern would otherwise match the trailing
	// `1.2` inside `26.1.2` (the `.` before the `1` is a word boundary) and misread
	// the version as legacy `1.2`.
	const modern = normalized.match(/\b(\d{2,})(?:\.(\d{1,2}))?(?:\.(\d{1,2}))?\b/);
	if (modern) {
		const major = Number(modern[1]);
		if (Number.isInteger(major) && major >= 26) {
			const minor = modern[2] != null ? Number(modern[2]) : 0;
			const patch = modern[3] != null ? Number(modern[3]) : null;
			return {
				major,
				minor: Number.isInteger(minor) ? minor : 0,
				patch: Number.isInteger(patch) ? patch : null,
			};
		}
	}

	// Legacy scheme: 1.20.4, 1.21
	const legacy = normalized.match(/\b1\.(\d{1,2})(?:\.(\d{1,2}))?\b/);
	if (legacy) {
		const minor = Number(legacy[1]);
		const patch = legacy[2] != null ? Number(legacy[2]) : null;
		if (!Number.isInteger(minor)) return null;
		return { major: 1, minor, patch: Number.isInteger(patch) ? patch : null };
	}

	return null;
};

const requirementFromMinecraftVersion = (version: ParsedMinecraftVersion): JavaRequirement => {
	if (version.major >= 26) {
		return {
			minimumMajor: 25,
			recommendedMajor: 25,
			confidence: 'high',
			summary: 'Minecraft 26+ should run on Java 25.',
			notes: ['Minecraft 26 and newer moved to the Java 25 runtime.'],
		};
	}

	if (version.minor >= 21) {
		return {
			minimumMajor: 21,
			recommendedMajor: 21,
			confidence: 'high',
			summary: 'Minecraft 1.21+ should run on Java 21.',
			notes: ['Use Java 21 for current major versions.'],
		};
	}

	if (version.minor === 20 && version.patch != null && version.patch >= 5) {
		return {
			minimumMajor: 21,
			recommendedMajor: 21,
			confidence: 'high',
			summary: 'Minecraft 1.20.5+ should run on Java 21.',
			notes: ['1.20.5 introduced Java 21 runtime requirements.'],
		};
	}

	if (version.minor >= 18) {
		return {
			minimumMajor: 17,
			recommendedMajor: 21,
			confidence: 'high',
			summary: 'Minecraft 1.18 - 1.20.4 needs Java 17 or newer.',
			notes: ['Java 21 is recommended for better long-term support.'],
		};
	}

	if (version.minor === 17) {
		return {
			minimumMajor: 16,
			recommendedMajor: 17,
			confidence: 'high',
			summary: 'Minecraft 1.17.x needs Java 16+.',
			notes: ['Java 17 often works, but validate your exact server build.'],
		};
	}

	return {
		minimumMajor: 8,
		recommendedMajor: 8,
		confidence: 'high',
		summary: 'Legacy Minecraft versions generally target Java 8.',
		notes: ['Older servers can fail on very new Java releases.'],
	};
};

export const resolveJavaRequirement = (
	provider?: string | null,
	version?: string | null,
): JavaRequirement => {
	const normalizedProvider = resolveProvider(provider)?.name;

	if (normalizedProvider === 'velocity') {
		return {
			minimumMajor: 17,
			recommendedMajor: 21,
			confidence: 'high',
			summary: 'Velocity 3.x+ should run on Java 17 or newer.',
			notes: ['Java 21 is recommended for current deployments.'],
		};
	}

	if (normalizedProvider === 'bungeecord') {
		return {
			minimumMajor: 8,
			recommendedMajor: 17,
			confidence: 'medium',
			summary: 'BungeeCord is commonly Java 8+, depending on build and plugins.',
			notes: ['Prefer Java 17 if your exact setup supports it.'],
		};
	}

	const parsedVersion = parseMinecraftVersion(version);
	if (parsedVersion) {
		return requirementFromMinecraftVersion(parsedVersion);
	}

	if (normalizedProvider === 'folia') {
		return {
			minimumMajor: 17,
			recommendedMajor: 21,
			confidence: 'medium',
			summary: 'Folia is designed for modern Java versions.',
			notes: ['Use Java 21 unless a specific build documents a different requirement.'],
		};
	}

	return {
		minimumMajor: 17,
		recommendedMajor: 21,
		confidence: 'medium',
		summary: 'Modern server builds are usually Java 17+.',
		notes: ['Exact requirement depends on your server version and provider release.'],
	};
};

export const isJavaCompatible = (javaMajor: number, requirement: JavaRequirement) =>
	javaMajor >= requirement.minimumMajor;

export const chooseBestInstalledJava = (
	installedMajors: number[],
	requirement: JavaRequirement,
): number | null => {
	const compatible = Array.from(new Set(installedMajors))
		.filter((major) => major >= requirement.minimumMajor)
		.sort((left, right) => left - right);

	if (compatible.length === 0) {
		return null;
	}

	const recommendedOrAbove = compatible.find((major) => major >= requirement.recommendedMajor);
	return recommendedOrAbove ?? compatible[compatible.length - 1];
};

export const evaluateJavaCompatibilityStatus = (
	installedMajors: number[],
	requirement: JavaRequirement,
): JavaCompatibilityStatus => {
	if (installedMajors.length === 0) {
		return 'needs-upgrade';
	}

	return installedMajors.some((major) => major >= requirement.minimumMajor) ? 'compatible' : 'needs-upgrade';
};
