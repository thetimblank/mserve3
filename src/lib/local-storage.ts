/**
 * localStorage helpers shared by the persisted Context stores in `data/`. Every
 * accessor is guarded: storage can be missing or throw (private mode, quota), and
 * the stores must keep working in memory when it does.
 */

export const hasLocalStorage = (): boolean => {
	try {
		return typeof window !== 'undefined' && !!window.localStorage;
	} catch {
		return false;
	}
};

/** Parsed JSON under `key`, or `undefined` when absent, unreadable, or corrupt. */
export const readStoredJson = (key: string): unknown => {
	if (!hasLocalStorage()) return undefined;
	try {
		const stored = window.localStorage.getItem(key);
		return stored ? JSON.parse(stored) : undefined;
	} catch {
		return undefined;
	}
};

/** Writes an already-serialized value; storage errors are ignored. */
export const writeStoredString = (key: string, serialized: string): void => {
	if (!hasLocalStorage()) return;
	try {
		window.localStorage.setItem(key, serialized);
	} catch {
		// Ignore storage errors
	}
};

/** Coerces a persisted date (ISO string or Date) to a Date, falling back to now. */
export const toDate = (value?: string | Date): Date => {
	if (value instanceof Date) return value;
	if (!value) return new Date();
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};
