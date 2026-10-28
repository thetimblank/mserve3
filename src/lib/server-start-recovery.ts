/**
 * Start-failure recovery, shared by the server page (`useServerRuntime`) and the
 * app-wide `ServerRuntimeMonitor` so a server recovers the same way wherever it
 * was started:
 *
 *  - a jar that rejects `--nogui`: drop the flag from mserve.json and retry once;
 *  - a wrong-Java boot failure (automatic Java only): step down to the next
 *    installed runtime, then offer to download the recommended one, once;
 *  - pin the Java a step-down found, so the next start is instant.
 *
 * Console lines only flag the cause ({@link noteRecoveryOutput}); recovery acts
 * on the authoritative `crashed` state ({@link recoverFromBootCrash}), so a
 * server that merely warns and keeps running is left alone.
 */
import type { Server, ServerUpdate } from '@/data/servers';
import { planJavaFallback, resolveServerJavaExecutable } from '@/lib/java-resolution';
import type { JavaRuntimeInfo } from '@/lib/java-runtime-service';
import { hasNoguiFlag, setServerCustomFlags, stripNoguiFlags } from '@/lib/server-flags-service';
import { getErrorMessage, isJavaVersionError, isNoguiUnsupportedError } from '@/lib/utils';

/** Per-server bookkeeping for one start cycle (create a fresh one per start). */
export type StartRecovery = {
	everRunning: boolean;
	javaErrorFlagged: boolean;
	noguiErrorFlagged: boolean;
	noguiStripAttempted: boolean;
	javaDownloadOffered: boolean;
	attemptedMajors: number[];
	didFallback: boolean;
	/** The Java executable the current attempt was started with. */
	executable: string | null;
};

type RecoveryServer = Pick<Server, 'id' | 'directory' | 'provider' | 'java_installation' | 'custom_flags'>;

export type RecoveryEnvironment = {
	globalDefault: string;
	runtimes: JavaRuntimeInfo[];
	/** Offers to download a Java major; resolves `null` when the user declines. */
	ensureJava: (majorVersion: number) => Promise<JavaRuntimeInfo | null>;
	updateServer: (id: string, update: ServerUpdate) => void;
	/** A progress line for the user (terminal line or toast). */
	report: (message: string) => void;
};

export type RecoveryOutcome =
	| { kind: 'retry'; executablePath: string }
	| { kind: 'none' }
	| { kind: 'failed'; message: string };

export const createStartRecovery = (
	executable: string | null = null,
	majorVersion: number | null = null,
): StartRecovery => ({
	everRunning: false,
	javaErrorFlagged: false,
	noguiErrorFlagged: false,
	noguiStripAttempted: false,
	javaDownloadOffered: false,
	attemptedMajors: majorVersion == null ? [] : [majorVersion],
	didFallback: false,
	executable,
});

/** A start nobody recorded (e.g. a backend wake): assume the Java a caller would resolve. */
export const createResolvedStartRecovery = (
	server: RecoveryServer,
	env: Pick<RecoveryEnvironment, 'globalDefault' | 'runtimes'>,
): StartRecovery => {
	const resolution = resolveServerJavaExecutable({
		provider: server.provider,
		javaInstallation: server.java_installation,
		globalDefault: env.globalDefault,
		runtimes: env.runtimes,
	});
	return resolution.status === 'resolved'
		? createStartRecovery(resolution.executablePath, resolution.majorVersion)
		: createStartRecovery();
};

const hasPinnedJava = (server: RecoveryServer) => (server.java_installation ?? '').trim() !== '';

/** Flags a boot failure's cause from one (ANSI-stripped) console line. */
export const noteRecoveryOutput = (recovery: StartRecovery, server: RecoveryServer, line: string) => {
	if (recovery.everRunning) return;
	// The jar rejects the flag whatever Java runs it, so this ignores a pin.
	if (isNoguiUnsupportedError(line)) recovery.noguiErrorFlagged = true;
	// A pinned Java is the user's explicit choice: never step it down.
	if (!hasPinnedJava(server) && isJavaVersionError(line)) recovery.javaErrorFlagged = true;
};

/**
 * A run that ended before the server came up, after printing a cause recovery
 * can act on. Usually that's a `crashed` exit, but some launchers exit with 0.
 */
export const hasFlaggedBootFailure = (recovery: StartRecovery) =>
	!recovery.everRunning && (recovery.javaErrorFlagged || recovery.noguiErrorFlagged);

/**
 * Records that the server came up. Returns the executable to pin when a
 * step-down was needed to find it, otherwise `null`.
 */
export const noteRecoveryOnline = (recovery: StartRecovery, server: RecoveryServer): string | null => {
	const pin = recovery.didFallback && !hasPinnedJava(server) ? recovery.executable : null;
	recovery.everRunning = true;
	recovery.javaErrorFlagged = false;
	recovery.noguiErrorFlagged = false;
	recovery.didFallback = false;
	recovery.attemptedMajors = [];
	return pin;
};

/**
 * Decides how to recover a run that ended in `crashed`. `retry` means start
 * again with `executablePath`; `none` means surface the crash; `failed` means
 * recovery was attempted but can't continue (show `message`).
 */
export const recoverFromBootCrash = async (
	recovery: StartRecovery,
	server: RecoveryServer,
	env: RecoveryEnvironment,
): Promise<RecoveryOutcome> => {
	if (recovery.everRunning) return { kind: 'none' };

	const flags = server.custom_flags ?? [];
	if (recovery.noguiErrorFlagged && !recovery.noguiStripAttempted && hasNoguiFlag(flags)) {
		recovery.noguiErrorFlagged = false;
		recovery.noguiStripAttempted = true;
		const retry = createResolvedStartRecovery(server, env);
		const executablePath = recovery.executable ?? retry.executable;
		if (executablePath) {
			const nextFlags = stripNoguiFlags(flags);
			try {
				await setServerCustomFlags(server.directory, nextFlags);
			} catch (err) {
				return {
					kind: 'failed',
					message: getErrorMessage(err, "Failed to remove '--nogui' from the server config."),
				};
			}
			env.updateServer(server.id, { custom_flags: nextFlags });
			recovery.executable = executablePath;
			env.report("This server doesn't support '--nogui'. Removed it and trying again...");
			return { kind: 'retry', executablePath };
		}
	}

	if (recovery.javaErrorFlagged && !hasPinnedJava(server)) {
		recovery.javaErrorFlagged = false;
		const plan = planJavaFallback({
			provider: server.provider,
			globalDefault: env.globalDefault,
			runtimes: env.runtimes,
			attemptedMajors: recovery.attemptedMajors,
		});
		if (plan.kind === 'retry') {
			recovery.attemptedMajors.push(plan.majorVersion);
			recovery.didFallback = true;
			recovery.executable = plan.executablePath;
			env.report(`That Java version was too old. Trying Java ${plan.majorVersion}...`);
			return { kind: 'retry', executablePath: plan.executablePath };
		}

		const requiredMajor = plan.requirement.recommendedMajor;
		if (!recovery.javaDownloadOffered) {
			recovery.javaDownloadOffered = true;
			env.report(`No installed Java worked. Trying to get Java ${requiredMajor}...`);
			const runtime = await env.ensureJava(requiredMajor);
			if (runtime) {
				recovery.attemptedMajors.push(runtime.majorVersion);
				recovery.didFallback = true;
				recovery.executable = runtime.executablePath;
				return { kind: 'retry', executablePath: runtime.executablePath };
			}
		}
		return {
			kind: 'failed',
			message: `No compatible Java runtime could start this server (needs Java ${requiredMajor}).`,
		};
	}

	return { kind: 'none' };
};
