/**
 * Helpers for the per-server `custom_flags` list (the "Extra Java flags" the
 * launcher appends after `-jar <file>`), plus the narrow persistence command the
 * automatic `--nogui` strip-and-retry uses.
 */
import { invoke } from '@tauri-apps/api/core';

/** Matches the flag in either the `--nogui` or bare `nogui` spelling. */
const NOGUI_FLAG_PATTERN = /^--?nogui$/i;

export const isNoguiFlag = (flag: string): boolean => NOGUI_FLAG_PATTERN.test(flag.trim());

export const hasNoguiFlag = (flags: readonly string[]): boolean => flags.some(isNoguiFlag);

export const stripNoguiFlags = (flags: readonly string[]): string[] =>
	flags.filter((flag) => !isNoguiFlag(flag));

/** Persists just `custom_flags` in mserve.json without touching other settings. */
export const setServerCustomFlags = (directory: string, customFlags: readonly string[]) =>
	invoke<void>('set_server_custom_flags', { directory, customFlags: [...customFlags] });
