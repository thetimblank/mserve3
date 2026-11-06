/**
 * Helpers for the per-server `custom_flags` list (the "Extra launch flags":
 * JVM options go before `-jar <file>`, server arguments after it), plus the
 * narrow persistence command the automatic `--nogui` strip-and-retry uses.
 */
import { invoke } from '@tauri-apps/api/core';

/** Matches the flag in either the `--nogui` or bare `nogui` spelling. */
const NOGUI_FLAG_PATTERN = /^--?nogui$/i;

const isNoguiFlag = (flag: string): boolean => NOGUI_FLAG_PATTERN.test(flag.trim());

export const hasNoguiFlag = (flags: readonly string[]): boolean => flags.some(isNoguiFlag);

export const stripNoguiFlags = (flags: readonly string[]): string[] =>
	flags.filter((flag) => !isNoguiFlag(flag));

/** Persists just `custom_flags` in mserve.json without touching other settings. */
export const setServerCustomFlags = (directory: string, customFlags: readonly string[]) =>
	invoke<void>('set_server_custom_flags', { directory, customFlags: [...customFlags] });

/** JVM options that take their value as the next token (`--add-opens x=y`). */
const JVM_OPTIONS_WITH_SEPARATE_VALUE = new Set([
	'--add-opens',
	'--add-exports',
	'--add-reads',
	'--add-modules',
	'--enable-native-access',
	'--module-path',
	'--upgrade-module-path',
	'--patch-module',
	'--limit-modules',
	'-cp',
	'-classpath',
	'--class-path',
]);

const JVM_FLAG_PREFIXES = [
	'-X',
	'-D',
	// A JVM argfile, like Forge's `@user_jvm_args.txt`.
	'@',
	'-javaagent:',
	'-agentlib:',
	'-agentpath:',
	'-verbose',
	'-ea:',
	'-da:',
	'-enableassertions',
	'-disableassertions',
	'--add-opens',
	'--add-exports',
	'--add-reads',
	'--add-modules',
	'--enable-native-access',
	'--enable-preview',
	'--illegal-access',
	'--sun-misc-unsafe-memory-access',
	'--module-path',
	'--upgrade-module-path',
	'--patch-module',
	'--limit-modules',
	'--class-path',
];
const JVM_EXACT_FLAGS = new Set(['-ea', '-da', '-esa', '-dsa', '-server', '-client', '-cp', '-classpath']);
const HEAP_SIZE_PREFIXES = ['-Xmx', '-Xms', '-XX:MaxHeapSize=', '-XX:InitialHeapSize='];

/** Heap sizes: mserve sets the heap itself (the Memory setting), so the launcher skips these. */
export const isHeapSizeFlag = (flag: string): boolean => HEAP_SIZE_PREFIXES.some((prefix) => flag.startsWith(prefix));

/**
 * True for a flag the JVM reads (it must come before `-jar`). Everything else,
 * like `--nogui`, is an argument for the server. Case matters: `-D`/`-X` are
 * Java's, lowercase `-d`/`-x` are not. Java's short `-p` is left out: Paper
 * uses it for the port.
 */
export const isJvmFlag = (flag: string): boolean =>
	JVM_EXACT_FLAGS.has(flag) || JVM_FLAG_PREFIXES.some((prefix) => flag.startsWith(prefix));

/**
 * Splits extra flags into JVM options and server arguments, keeping each
 * group's order; heap sizes are skipped. Mirrors `split_custom_flags` in
 * `commands/runtime.rs`.
 */
export const splitCustomFlags = (
	flags: readonly string[],
): { jvm: string[]; server: string[]; ignoredHeap: string[] } => {
	const jvm: string[] = [];
	const server: string[] = [];
	const ignoredHeap: string[] = [];
	for (let index = 0; index < flags.length; index++) {
		const flag = flags[index];
		if (isHeapSizeFlag(flag)) {
			ignoredHeap.push(flag);
			continue;
		}
		if (!isJvmFlag(flag)) {
			server.push(flag);
			continue;
		}
		jvm.push(flag);
		if (JVM_OPTIONS_WITH_SEPARATE_VALUE.has(flag) && index + 1 < flags.length) {
			jvm.push(flags[++index]);
		}
	}
	return { jvm, server, ignoredHeap };
};
