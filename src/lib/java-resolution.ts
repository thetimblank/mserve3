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
 */
export const planJavaFallback = (args: {
	provider?: JavaProviderRef | null;
	globalDefault?: string | null;
	runtimes: JavaRuntimeInfo[];
	attemptedMajors: number[];
}): JavaFallbackPlan => {
	const resolution = resolveServerJavaExecutable({
		provider: args.provider,
		javaInstallation: '',
		globalDefault: args.globalDefault,
		runtimes: args.runtimes,
		excludeMajors: args.attemptedMajors,
	});

	if (resolution.status === 'missing') {
		return { kind: 'missing', requirement: resolution.requirement };
	}

	if (resolution.majorVersion != null && args.attemptedMajors.includes(resolution.majorVersion)) {
		return { kind: 'exhausted', requirement: resolution.requirement };
	}

	return {
		kind: 'retry',
		executablePath: resolution.executablePath,
		majorVersion: resolution.majorVersion ?? 0,
	};
};
