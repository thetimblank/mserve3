import * as TOML from '@iarna/toml';

type TomlTable = Record<string, unknown>;

type KeyLocation = {
	/** First and last line of the `key = value` entry (values can span lines). */
	start: number;
	end: number;
	indent: string;
	keyText: string;
	comment: string;
};

type Section = {
	/** Header line, or -1 for the root table. */
	header: number;
	/** Last line that belongs to an entry, for appending new keys. */
	lastEntry: number;
	keys: Map<string, KeyLocation>;
};

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const KEY_LINE = /^(\s*)("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*=\s*(.*)$/;
const TABLE_HEADER = /^\s*\[\s*([A-Za-z0-9_-]+)\s*\]\s*(?:#.*)?$/;

const isTable = (value: unknown): value is TomlTable =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

/** JSON with table keys sorted, so key order doesn't count as a difference. */
const canonical = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (isTable(value)) {
		const keys = Object.keys(value).sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value) ?? 'undefined';
};

const sameValue = (left: unknown, right: unknown) => canonical(left) === canonical(right);

const parsesAsValue = (text: string) => {
	try {
		TOML.parse(`x = ${text}`);
		return true;
	} catch {
		return false;
	}
};

const unquoteKey = (keyText: string) => {
	if (BARE_KEY.test(keyText)) return keyText;
	try {
		return Object.keys(TOML.parse(`${keyText} = 0`))[0] ?? null;
	} catch {
		return null;
	}
};

/** Splits `value # comment` without cutting a `#` that sits inside a string. */
const splitTrailingComment = (rest: string) => {
	for (let index = rest.indexOf('#'); index !== -1; index = rest.indexOf('#', index + 1)) {
		const value = rest.slice(0, index).trimEnd();
		if (value && parsesAsValue(value)) return { value, comment: rest.slice(index).trimEnd() };
	}
	return { value: rest.trimEnd(), comment: '' };
};

/** Maps each top-level and one-level-table key to its lines. `null` for layouts we don't patch. */
const indexDocument = (lines: string[]) => {
	const sections = new Map<string, Section>([['', { header: -1, lastEntry: -1, keys: new Map() }]]);
	let current: Section | null = sections.get('') ?? null;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		if (trimmed.startsWith('[')) {
			const header = TABLE_HEADER.exec(line);
			// Arrays of tables and dotted/quoted headers: leave those sections alone.
			if (!header || sections.has(header[1])) return null;
			current = { header: index, lastEntry: index, keys: new Map() };
			sections.set(header[1], current);
			continue;
		}

		const match = KEY_LINE.exec(line);
		const key = match ? unquoteKey(match[2]) : null;
		if (!match || key === null || !current) return null;

		let end = index;
		let { value, comment } = splitTrailingComment(match[3]);
		if (!parsesAsValue(value)) {
			// A value spanning lines (a multi-line array or string): extend until it parses.
			let joined = match[3];
			comment = '';
			while (end + 1 < lines.length && !parsesAsValue(joined)) {
				end += 1;
				joined += `\n${lines[end]}`;
			}
			if (!parsesAsValue(joined)) return null;
			value = joined;
		}

		current.keys.set(key, { start: index, end, indent: match[1], keyText: match[2], comment });
		current.lastEntry = end;
		index = end;
	}

	return sections;
};

type Edit = { section: string; key: string; value: unknown; removed: boolean };

/** The key-level edits that turn `previous` into `next`, or `null` for deeper changes. */
const diffRoots = (previous: TomlTable, next: TomlTable): Edit[] | null => {
	const edits: Edit[] = [];
	const diffTable = (section: string, before: TomlTable, after: TomlTable) => {
		for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
			const had = Object.prototype.hasOwnProperty.call(before, key);
			const has = Object.prototype.hasOwnProperty.call(after, key);
			const beforeValue = before[key];
			const afterValue = after[key];
			if (had && has && sameValue(beforeValue, afterValue)) continue;

			const tableBefore = had && isTable(beforeValue);
			const tableAfter = has && isTable(afterValue);
			if (tableBefore || tableAfter) {
				// Only `[table]` sections directly under the root are patched in place.
				if (section !== '' || !tableBefore || !tableAfter) return false;
				if (!diffTable(key, beforeValue, afterValue)) return false;
				continue;
			}
			edits.push({ section, key, value: afterValue, removed: !has });
		}
		return true;
	};
	return diffTable('', previous, next) ? edits : null;
};

/**
 * Writes `next` into the TOML document `original` by editing only the entries
 * whose values changed, so comments and layout survive (TOML.stringify drops
 * them all). Returns `null` when an edit can't be placed safely, such as a new
 * table or a change inside a nested one; callers then rewrite the whole file.
 */
export const patchTomlText = (original: string, next: TomlTable): string | null => {
	let previous: TomlTable;
	try {
		previous = TOML.parse(original);
	} catch {
		return null;
	}

	const newline = original.includes('\r\n') ? '\r\n' : '\n';
	const lines = original.split(/\r?\n/);
	const sections = indexDocument(lines);
	const edits = diffRoots(previous, next);
	if (!sections || !edits) return null;
	if (edits.length === 0) return original;

	const replacements = new Map<number, { end: number; text: string[] }>();
	const insertions = new Map<number, string[]>();

	for (const edit of edits) {
		const section = sections.get(edit.section);
		if (!section) return null;
		const location = section.keys.get(edit.key);

		if (edit.removed) {
			if (!location) return null;
			replacements.set(location.start, { end: location.end, text: [] });
			continue;
		}

		const valueText = TOML.stringify.value(edit.value as TOML.AnyJson);
		if (location) {
			const comment = location.comment ? ` ${location.comment}` : '';
			replacements.set(location.start, {
				end: location.end,
				text: [`${location.indent}${location.keyText} = ${valueText}${comment}`],
			});
			continue;
		}

		const keyText = BARE_KEY.test(edit.key) ? edit.key : JSON.stringify(edit.key);
		let after = section.lastEntry;
		if (section.header === -1 && section.lastEntry === -1) {
			// New root keys must come before the first table header, and above the
			// comment block that describes it.
			after = ([...sections.values()].find((entry) => entry.header >= 0)?.header ?? lines.length) - 1;
			while (after >= 0 && lines[after].trim().startsWith('#')) after -= 1;
		}
		insertions.set(after, [...(insertions.get(after) ?? []), `${keyText} = ${valueText}`]);
	}

	const output: string[] = [];
	for (const inserted of insertions.get(-1) ?? []) output.push(inserted);
	for (let index = 0; index < lines.length; index += 1) {
		const replacement = replacements.get(index);
		if (replacement) {
			output.push(...replacement.text);
			index = replacement.end;
		} else {
			output.push(lines[index]);
		}
		for (const inserted of insertions.get(index) ?? []) output.push(inserted);
	}

	const patched = output.join(newline);
	// Belt and braces: only hand back text that parses to exactly `next`.
	try {
		return sameValue(TOML.parse(patched), next) ? patched : null;
	} catch {
		return null;
	}
};
