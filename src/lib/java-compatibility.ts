import { resolveProvider } from '@/lib/server-provider';

export type JavaCompatibilityConfidence = 'high' | 'medium';

export type JavaCompatibilityStatus = 'compatible' | 'needs-upgrade' | 'unknown';

export type JavaRequirement = {
	minimumMajor: number;
	recommendedMajor: number;
	confidence: JavaCompatibilityConfidence;
	summary: string;
	notes: string[];
};

export type JavaCompatibilityMatrixRow = {
	label: string;
	serverScope: string;
	minimumMajor: number;
	recommendedMajor: number;
	notes: string;
};

export const JAVA_COMPATIBILITY_MATRIX: JavaCompatibilityMatrixRow[] = [
	{
		label: 'Minecraft 26+',
		serverScope: 'Vanilla, Paper, Folia, Spigot',
		minimumMajor: 25,
		recommendedMajor: 25,
		notes: 'Current modern server versions should use Java 25.',
	},
	{
		label: 'Minecraft 1.20.5 - 1.21',
		serverScope: 'Vanilla, Paper, Folia, Spigot',
		minimumMajor: 21,
		recommendedMajor: 21,
		notes: '1.20.5+ moved to Java 21 requirements.',
	},
	{
		label: 'Minecraft 1.18 - 1.20.4',
		serverScope: 'Vanilla, Paper, Folia, Spigot',
		minimumMajor: 17,
		recommendedMajor: 21,
		notes: 'Java 17 is the baseline. Java 21 is recommended for long-term support.',
	},
	{
		label: 'Minecraft 1.17.x',
		serverScope: 'Vanilla, Paper, Spigot',
		minimumMajor: 16,
		recommendedMajor: 17,
		notes: 'Java 16 is required. Java 17 often works but check your exact build.',
	},
	{
		label: 'Minecraft 1.16.5 and older',
		serverScope: 'Legacy Vanilla/Paper/Spigot',
		minimumMajor: 8,
		recommendedMajor: 8,
		notes: 'Legacy builds usually target Java 8.',
	},
	{
		label: 'Velocity 3.x+',
		serverScope: 'Velocity proxy',
		minimumMajor: 17,
		recommendedMajor: 21,
		notes: 'Use at least Java 17 for modern Velocity builds.',
	},
	{
		label: 'BungeeCord / Waterfall',
		serverScope: 'BungeeCord proxy',
		minimumMajor: 8,
		recommendedMajor: 17,
		notes: 'Many legacy installs run on Java 8, but Java 17 is preferred when supported.',
	},
];

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

	// Legacy scheme: 1.20.4, 1.21
	const legacy = normalized.match(/\b1\.(\d{1,2})(?:\.(\d{1,2}))?\b/);
	if (legacy) {
		const minor = Number(legacy[1]);
		const patch = legacy[2] != null ? Number(legacy[2]) : null;
		if (!Number.isInteger(minor)) return null;
		return { major: 1, minor, patch: Number.isInteger(patch) ? patch : null };
	}

	// Modern year-based snapshots: 26w03a
	const snapshot = normalized.match(/\b(\d{2})w\d{2}[a-z]\b/);
	if (snapshot) {
		const year = Number(snapshot[1]);
		if (Number.isInteger(year) && year >= 26) {
			return { major: year, minor: 0, patch: null };
		}
	}

	// Modern year-based releases: 26, 26.1, 26.1.2
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

export const explainCompatibility = (options: {
	provider?: string | null;
	version?: string | null;
	installedMajors: number[];
}) => {
	const requirement = resolveJavaRequirement(options.provider, options.version);
	const status = evaluateJavaCompatibilityStatus(options.installedMajors, requirement);
	const bestInstalledMajor = chooseBestInstalledJava(options.installedMajors, requirement);

	if (status === 'compatible') {
		return {
			requirement,
			status,
			bestInstalledMajor,
			message: `Compatible. This server needs Java ${requirement.minimumMajor}+ and Java ${bestInstalledMajor} is available.`,
		};
	}

	if (options.installedMajors.length === 0) {
		return {
			requirement,
			status,
			bestInstalledMajor,
			message: `No Java runtime was detected. Install Java ${requirement.recommendedMajor} (minimum ${requirement.minimumMajor}).`,
		};
	}

	const highestInstalled = Math.max(...options.installedMajors);
	return {
		requirement,
		status,
		bestInstalledMajor,
		message: `Installed Java ${highestInstalled} is too old for this server. Install Java ${requirement.recommendedMajor} (minimum ${requirement.minimumMajor}).`,
	};
};

export const describeWhatCanRunWithJava = (javaMajor: number): string[] => {
	if (javaMajor >= 25) {
		return [
			'Minecraft 26+ on Vanilla/Paper/Folia/Spigot',
			'Minecraft 1.20.5+ (including 1.21+)',
			'Minecraft 1.18 - 1.20.4',
			'Velocity 3.x+ proxies',
		];
	}

	if (javaMajor >= 21) {
		return [
			'Minecraft 1.20.5+ (including 1.21+) on Vanilla/Paper/Folia/Spigot',
			'Minecraft 1.18 - 1.20.4',
			'Velocity 3.x+ proxies',
			'BungeeCord/Waterfall setups that support newer Java releases',
		];
	}

	if (javaMajor >= 17) {
		return [
			'Minecraft 1.18 - 1.20.4 on Vanilla/Paper/Folia/Spigot',
			'Velocity 3.x+ proxies',
			'Many legacy servers that accept newer Java versions',
		];
	}

	if (javaMajor >= 16) {
		return ['Minecraft 1.17.x', 'Most Minecraft 1.16.5 and older builds'];
	}

	if (javaMajor >= 8) {
		return ['Minecraft 1.16.5 and older', 'Many BungeeCord/Waterfall legacy installs'];
	}

	return ['This Java runtime is too old for modern Minecraft servers.'];
};
