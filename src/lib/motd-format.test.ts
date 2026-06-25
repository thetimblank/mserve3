import { describe, expect, it } from 'vitest';

import {
	applyMotdAlignment,
	getEditableMotdValue,
	getStoredMotdValue,
	parseMotdPreviewLines,
	stripMotdAlignmentEscape,
} from './motd-format';

const SECTION = '§';

describe('legacy MOTD store/load round-trip (server.properties)', () => {
	it('joins two editor lines onto one physical line with a literal \\n', () => {
		const editable = `${SECTION}cHello\nWorld`;
		const stored = getStoredMotdValue(editable, 'legacy');

		// No real newline in the stored value.
		expect(stored.includes('\n')).toBe(false);
		// Literal backslash-n separates the lines, section sign is escaped.
		expect(stored).toBe('\\u00A7cHello\\nWorld');
	});

	it('restores the two lines from the stored literal \\n', () => {
		const stored = '\\u00A7cHello\\nWorld';
		const editable = getEditableMotdValue(stored, 'legacy');
		expect(editable).toBe(`${SECTION}cHello\nWorld`);
		expect(editable.split('\n')).toHaveLength(2);
	});

	it('protects a centered first line with a leading backslash', () => {
		const editable = `          ${SECTION}9${SECTION}otest\n          test`;
		const stored = getStoredMotdValue(editable, 'legacy');
		expect(stored.startsWith('\\ ')).toBe(true); // backslash then the kept spaces
		expect(stored.includes('\n')).toBe(false);

		// Loading keeps the backslash so the source editor can show it, and the
		// visible spaces are preserved exactly.
		const loaded = getEditableMotdValue(stored, 'legacy');
		expect(loaded).toBe(`\\${editable}`);
		expect(stripMotdAlignmentEscape(loaded.split('\n')[0])).toBe(`          ${SECTION}9${SECTION}otest`);

		// Re-storing the loaded value is idempotent (no second backslash).
		expect(getStoredMotdValue(loaded, 'legacy')).toBe(stored);
	});

	it('does not double-escape an already-escaped value', () => {
		const editable = `\\          ${SECTION}9text`;
		const stored = getStoredMotdValue(editable, 'legacy');
		expect(stored.startsWith('\\\\')).toBe(false);
		expect(stored.startsWith('\\ ')).toBe(true);
	});
});

describe('alignment backslash is hidden in the preview but produced for storage', () => {
	it('strips the leading backslash from the visible first line', () => {
		const value = `\\          ${SECTION}9hi`;
		const [firstLine] = parseMotdPreviewLines(value, 'legacy');
		const text = firstLine.map((run) => run.text).join('');
		expect(text.startsWith('\\')).toBe(false);
		expect(text).toBe('          hi');
	});

	it('center alignment adds spaces and the protective backslash', () => {
		const aligned = applyMotdAlignment('hi', 'legacy', 'center');
		expect(aligned.startsWith('\\ ')).toBe(true);
		// Stored form keeps it on one physical line.
		expect(getStoredMotdValue(aligned, 'legacy').includes('\n')).toBe(false);
	});

	it('right alignment can push short text far past 44 characters of spaces', () => {
		const aligned = applyMotdAlignment('a', 'legacy', 'right');
		const visible = stripMotdAlignmentEscape(aligned);
		const leadingSpaces = visible.length - visible.replace(/^ +/, '').length;
		expect(leadingSpaces).toBeGreaterThan(44);
		expect(leadingSpaces).toBeLessThanOrEqual(66);
	});
});

describe('minimessage MOTD is unaffected by the legacy escaping', () => {
	it('keeps real newlines for the TOML serializer and adds no backslash', () => {
		const editable = '<blue>Hello\nWorld';
		const stored = getStoredMotdValue(editable, 'minimessage');
		expect(stored).toBe('<blue>Hello\nWorld');
		expect(getEditableMotdValue(stored, 'minimessage')).toBe(editable);
	});
});
