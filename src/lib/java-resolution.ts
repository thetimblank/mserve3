import {
	isJavaCompatible,
	resolveJavaRequirement,
	type JavaRequirement,
} from '@/lib/java-compatibility';
import {
	findJavaRuntimeByExecutablePath,
	resolveJavaRuntimeForRequirement,
	type JavaRuntimeInfo,
} from '@/lib/java-runtime-service';

export type JavaProviderRef = { name: string; minecraft_version: string };

export type JavaResolution =
	| {
			status: 'resolved';
			executablePath: string;
			majorVersion: number | null;
			runtime: JavaRuntimeInfo | null;
			/** true when the path came from an explicit per-server / global pin. */
			pinned: boolean;
			requirement: JavaRequirement;
	  }
	| { status: 'missing'; requirement: JavaRequirement };

type ResolveArgs = {
	provider?: JavaProviderRef | null;
	/** Per-server override path ('' = automatic). */
	javaInstallation?: string | null;
	/** Global default/pin path ('' = automatic). */
	globalDefault?: string | null;
	runtimes: JavaRuntimeInfo[];
	/** Java majors to skip — drives the start-failure fallback. */
	excludeMajors?: number[];
};

const newestRuntime = (runtimes: JavaRuntimeInfo[]): JavaRuntimeInfo | null =>
	runtimes.reduce<JavaRuntimeInfo | null>(
		(best, runtime) => (!best || runtime.majorVersion > best.majorVersion ? runtime : best),
		null,
	);

/**
 * The single source of truth for "which Java should launch this server".
 *
 * Precedence: per-server pin → compatible global pin → best compatible detected
 * runtime for the requirement → newest detected runtime (when none are strictly
 * compatible) → missing. Used by the start sites, the "Using Java X" badge, and
 * the start-failure retry loop (via `excludeMajors`).
 */
export const resolveServerJavaExecutable = ({
	provider,
	javaInstallation,
	globalDefault,
	runtimes,
	excludeMajors = [],
}: ResolveArgs): JavaResolution => {
	const requirement = resolveJavaRequirement(provider?.name, provider?.minecraft_version);
	const excluded = new Set(excludeMajors);
	const candidates = runtimes.filter((runtime) => !excluded.has(runtime.majorVersion));

	// 1. Per-server pin wins outright (advanced override). Honor a custom path even
	//    if it isn't in the detected list; match it only to derive the label.
	const pinPath = (javaInstallation ?? '').trim();
	if (pinPath) {
		const runtime = findJavaRuntimeByExecutablePath(pinPath, runtimes);
		return {
			status: 'resolved',
			executablePath: pinPath,
			majorVersion: runtime?.majorVersion ?? null,
			runtime,
			pinned: true,
			requirement,
		};
	}

	// 2. Global pin, but only when it's compatible with this server's requirement.
	const globalPath = (globalDefault ?? '').trim();
	if (globalPath) {
		const runtime = findJavaRuntimeByExecutablePath(globalPath, runtimes);
		const usable =
			(!runtime || isJavaCompatible(runtime.majorVersion, requirement)) &&
			!(runtime && excluded.has(runtime.majorVersion));
		if (usable) {
			return {
				status: 'resolved',
				executablePath: globalPath,
				majorVersion: runtime?.majorVersion ?? null,
				runtime,
				pinned: true,
				requirement,
			};
		}
	}

	// 3. Automatic: the best compatible detected runtime for the requirement.
	const best = resolveJavaRuntimeForRequirement(candidates, requirement);
	if (best) {
		return {
			status: 'resolved',
			executablePath: best.executablePath,
			majorVersion: best.majorVersion,
			runtime: best,
			pinned: false,
			requirement,
		};
	}

	// 4. Nothing strictly compatible but runtimes exist → default to the newest.
	const newest = newestRuntime(candidates);
	if (newest) {
		return {
			status: 'resolved',
			executablePath: newest.executablePath,
			majorVersion: newest.majorVersion,
			runtime: newest,
			pinned: false,
			requirement,
		};
	}

	// 5. No usable runtime at all → caller offers download / Java guide.
	return { status: 'missing', requirement };
};

export const javaResolutionLabel = (resolution: JavaResolution): string | null =>
	resolution.status === 'resolved' && resolution.majorVersion != null
		? `Using Java ${resolution.majorVersion}`
		: null;

export type JavaFallbackPlan =
	| { kind: 'retry'; executablePath: string; majorVersion: number }
	| { kind: 'missing'; requirement: JavaRequirement }
	| { kind: 'exhausted'; requirement: JavaRequirement };

/**
 * Picks the next Java to try after a server failed to start with a version
 * error. Only meaningful in automatic mode — a per-server pin should surface the
 * error instead of being silently overridden.
 *
 * Sweep order: compatible versions *above* the last attempt (lowest-first, i.e.
 * closest first) → compatible versions *below* (highest-first) → incompatible
 * versions (highest-first, last resort). This ensures that when the automatic
 * selection picks a mid-range version we still try higher ones before giving up.
 */
export const planJavaFallback = (args: {
	provider?: JavaProviderRef | null;
	globalDefault?: string | null;
	runtimes: JavaRuntimeInfo[];
	attemptedMajors: number[];
}): JavaFallbackPlan => {
	const requirement = resolveJavaRequirement(args.provider?.name, args.provider?.minecraft_version);
	const attempted = new Set(args.attemptedMajors);
	const lastAttempted = args.attemptedMajors[args.attemptedMajors.length - 1] ?? 0;

	// One candidate per major version; skip already-attempted ones.
	const seenMajors = new Set<number>();
	const candidates: JavaRuntimeInfo[] = [];
	for (const runtime of args.runtimes) {
		if (attempted.has(runtime.majorVersion) || seenMajors.has(runtime.majorVersion)) continue;
		seenMajors.add(runtime.majorVersion);
		candidates.push(runtime);
	}

	if (candidates.length === 0) {
		return { kind: 'missing', requirement };
	}

	// 1. Compatible versions above the last attempt (closest first).
	const aboveCompatible = candidates
		.filter((r) => r.majorVersion > lastAttempted && r.majorVersion >= requirement.minimumMajor)
		.sort((a, b) => a.majorVersion - b.majorVersion);

	// 2. Compatible versions at or below the last attempt (closest first).
	const belowCompatible = candidates
		.filter((r) => r.majorVersion <= lastAttempted && r.majorVersion >= requirement.minimumMajor)
		.sort((a, b) => b.majorVersion - a.majorVersion);

	// 3. Incompatible versions as a last resort (closest to minimum first).
	const fallbackIncompatible = candidates
		.filter((r) => r.majorVersion < requirement.minimumMajor)
		.sort((a, b) => b.majorVersion - a.majorVersion);

	const next = aboveCompatible[0] ?? belowCompatible[0] ?? fallbackIncompatible[0];

	if (!next) {
		return { kind: 'missing', requirement };
	}

	return { kind: 'retry', executablePath: next.executablePath, majorVersion: next.majorVersion };
};
