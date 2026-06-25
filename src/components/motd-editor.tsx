import * as React from 'react';
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	Bold,
	Italic,
	Palette,
	Paintbrush,
	Sparkles,
	Strikethrough,
	Type,
	Underline,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
	applyMotdAlignment,
	applyMotdAlignmentEscape,
	measureMotdRunsWidth,
	measureMotdWidth,
	motdCharAdvance,
	MOTD_COLOR_OPTIONS,
	MOTD_DECORATION_OPTIONS,
	MOTD_LINE_PIXEL_BUDGET,
	MOTD_MAX_LINES,
	MOTD_VISUAL_LINE_WIDTH,
	MOTD_VISUAL_LINE_WIDTH_BOLD,
	parseMotdPreviewLines,
	type MotdAlignment,
	type MotdDecorationKey,
	type MotdFormat,
	type MotdPreviewEffect,
	type MotdPreviewRun,
	type MotdPreviewStyle,
} from '@/lib/motd-format';
import { Container } from './ui/container';

type MotdEditorProps = {
	value: string;
	onChange: (nextValue: string) => void;
	format: MotdFormat;
	advancedMode?: boolean;
	disabled?: boolean;
	label: string;
	description: string;
	className?: string;
};

type MotdEditorSelection = {
	startLine: number;
	startOffset: number;
	endLine: number;
	endOffset: number;
};

type MotdRichLine = MotdPreviewRun[];

const SECTION_SIGN = '\u00a7';
const MINI_DECORATION_TAGS: Record<MotdDecorationKey, string> = {
	bold: 'bold',
	italic: 'italic',
	underlined: 'underlined',
	strikethrough: 'strikethrough',
	obfuscated: 'obfuscated',
};

const EMPTY_STYLE: MotdPreviewStyle = {
	color: undefined,
	colorToken: undefined,
	shadowColor: undefined,
	shadowToken: undefined,
	bold: false,
	italic: false,
	underlined: false,
	strikethrough: false,
	obfuscated: false,
};

const NORMALIZED_DECORATION_KEYS: MotdDecorationKey[] = [
	'bold',
	'italic',
	'underlined',
	'strikethrough',
	'obfuscated',
];

const normalizeStyle = (style?: MotdPreviewStyle): MotdPreviewStyle => ({
	...EMPTY_STYLE,
	...style,
	bold: Boolean(style?.bold),
	italic: Boolean(style?.italic),
	underlined: Boolean(style?.underlined),
	strikethrough: Boolean(style?.strikethrough),
	obfuscated: Boolean(style?.obfuscated),
});

const cloneRun = (run: MotdPreviewRun): MotdPreviewRun => ({
	text: run.text,
	style: normalizeStyle(run.style),
	effect: run.effect ? { ...run.effect } : undefined,
});

const getDecorationLine = (style: MotdPreviewStyle) =>
	[style.underlined ? 'underline' : null, style.strikethrough ? 'line-through' : null]
		.filter(Boolean)
		.join(' ');

const buildTextShadow = (style: MotdPreviewStyle, textColor: string) => {
	const parts: string[] = [];

	// Minecraft renders bold by drawing each glyph a second time 1px to the right
	// (not with a heavier font weight). Emulating that with a text-shadow keeps the
	// thickening on the correct side instead of the faux-bold down-and-left smear.
	if (style.bold) {
		parts.push(`1px 0 0 ${textColor}`);
	}

	if (style.shadowColor) {
		parts.push(`0 0 0.15em ${style.shadowColor}`, `0.05em 0.05em 0 ${style.shadowColor}`);
	}

	return parts.length > 0 ? parts.join(', ') : undefined;
};

const toEditorCss = (run: MotdPreviewRun, colorOverride?: string): React.CSSProperties => {
	const style = normalizeStyle(run.style);
	const decorationLine = getDecorationLine(style);
	const color = colorOverride ?? style.color;

	return {
		color,
		fontWeight: 400,
		fontStyle: style.italic ? 'italic' : 'normal',
		textDecorationLine: decorationLine || undefined,
		textShadow: buildTextShadow(style, color ?? 'currentColor'),
		whiteSpace: 'pre-wrap',
	};
};

const hexToRgb = (value: string) => {
	const normalized = value.replace(/^#/, '').trim();
	if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;

	return {
		r: Number.parseInt(normalized.slice(0, 2), 16),
		g: Number.parseInt(normalized.slice(2, 4), 16),
		b: Number.parseInt(normalized.slice(4, 6), 16),
	};
};

const rgbToCss = (color: { r: number; g: number; b: number }) => `rgb(${color.r} ${color.g} ${color.b})`;

const mixRgb = (
	left: { r: number; g: number; b: number },
	right: { r: number; g: number; b: number },
	t: number,
) => ({
	r: Math.round(left.r + (right.r - left.r) * t),
	g: Math.round(left.g + (right.g - left.g) * t),
	b: Math.round(left.b + (right.b - left.b) * t),
});

const resolveEffectColor = (effect: MotdPreviewEffect, index: number, total: number) => {
	const progress = total <= 1 ? 0 : index / (total - 1);
	const shiftedProgress = (((progress + effect.phase) % 1) + 1) % 1;

	if (effect.type === 'rainbow') {
		const hue = Math.round(shiftedProgress * 360);
		return `hsl(${hue} 90% 60%)`;
	}

	const colors = effect.colors.length > 0 ? effect.colors : ['#ffffff'];
	if (colors.length === 1) {
		return colors[0];
	}

	const scaled = shiftedProgress * (colors.length - 1);
	const leftIndex = Math.min(colors.length - 1, Math.max(0, Math.floor(scaled)));
	const rightIndex = Math.min(colors.length - 1, leftIndex + 1);
	const localProgress = scaled - leftIndex;
	const left = hexToRgb(colors[leftIndex]) ?? { r: 255, g: 255, b: 255 };
	const right = hexToRgb(colors[rightIndex]) ?? left;
	return rgbToCss(mixRgb(left, right, effect.reverse ? 1 - localProgress : localProgress));
};

const stylePayload = (run: MotdPreviewRun) =>
	JSON.stringify({
		style: normalizeStyle(run.style),
		effect: run.effect,
	});

const parseStylePayload = (value: string | null): MotdPreviewRun => {
	if (!value) {
		return { text: '', style: normalizeStyle() };
	}

	try {
		const parsed = JSON.parse(value) as {
			style?: MotdPreviewStyle;
			effect?: MotdPreviewEffect;
		};

		return {
			text: '',
			style: normalizeStyle(parsed.style),
			effect: parsed.effect,
		};
	} catch {
		return { text: '', style: normalizeStyle() };
	}
};

const areEffectsEqual = (left?: MotdPreviewEffect, right?: MotdPreviewEffect) =>
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const areStylesEqual = (left?: MotdPreviewStyle, right?: MotdPreviewStyle) => {
	const normalizedLeft = normalizeStyle(left);
	const normalizedRight = normalizeStyle(right);

	return (
		normalizedLeft.color === normalizedRight.color &&
		normalizedLeft.colorToken === normalizedRight.colorToken &&
		normalizedLeft.shadowColor === normalizedRight.shadowColor &&
		normalizedLeft.shadowToken === normalizedRight.shadowToken &&
		normalizedLeft.bold === normalizedRight.bold &&
		normalizedLeft.italic === normalizedRight.italic &&
		normalizedLeft.underlined === normalizedRight.underlined &&
		normalizedLeft.strikethrough === normalizedRight.strikethrough &&
		normalizedLeft.obfuscated === normalizedRight.obfuscated
	);
};

const areRunsVisuallyEqual = (left: MotdPreviewRun, right: MotdPreviewRun) =>
	areStylesEqual(left.style, right.style) && areEffectsEqual(left.effect, right.effect);

const appendRun = (runs: MotdPreviewRun[], run: MotdPreviewRun) => {
	const text = run.text.replace(/\u00a0/g, ' ').replace(/\r?\n/g, '');
	if (!text) return;

	const normalizedRun = {
		text,
		style: normalizeStyle(run.style),
		effect: run.effect ? { ...run.effect } : undefined,
	};
	const previous = runs[runs.length - 1];

	if (previous && areRunsVisuallyEqual(previous, normalizedRun)) {
		previous.text += normalizedRun.text;
		return;
	}

	runs.push(normalizedRun);
};

const mergeRuns = (runs: MotdPreviewRun[]) =>
	runs.reduce<MotdPreviewRun[]>((nextRuns, run) => {
		appendRun(nextRuns, run);
		return nextRuns;
	}, []);

// Character count — used for caret/selection offsets, which are per-character.
const getRunsLength = (runs: MotdPreviewRun[]) => runs.reduce((total, run) => total + run.text.length, 0);

const lineHasBold = (runs: MotdPreviewRun[]) => runs.some((run) => Boolean(run.style.bold));

// Slice text so its rendered pixel width does not exceed `remaining`, allowing the
// final glyph to tip over the budget (matching how Minecraft fits the last char).
const sliceTextToBudget = (text: string, bold: boolean, remaining: number) => {
	let used = 0;
	let output = '';
	for (const char of text) {
		if (used >= remaining) break;
		output += char;
		used += motdCharAdvance(char, bold);
	}
	return output;
};

const clampRunsToWidth = (runs: MotdPreviewRun[]) => {
	let used = 0;
	const nextRuns: MotdPreviewRun[] = [];

	for (const run of runs) {
		if (used >= MOTD_LINE_PIXEL_BUDGET) break;

		const bold = Boolean(run.style.bold);
		const text = sliceTextToBudget(run.text, bold, MOTD_LINE_PIXEL_BUDGET - used);
		appendRun(nextRuns, { ...cloneRun(run), text });
		used += measureMotdWidth(text, bold);
	}

	return nextRuns;
};

const getEditorLinesFromValue = (value: string, format: MotdFormat): MotdRichLine[] => {
	const parsedLines = parseMotdPreviewLines(value, format).slice(0, MOTD_MAX_LINES);
	const lines = Array.from({ length: MOTD_MAX_LINES }, (_, index) =>
		clampRunsToWidth((parsedLines[index] ?? []).map(cloneRun)),
	);

	return lines;
};

const isBaseStyle = (style?: MotdPreviewStyle) => {
	const normalized = normalizeStyle(style);
	return (
		!normalized.color &&
		!normalized.shadowColor &&
		!normalized.bold &&
		!normalized.italic &&
		!normalized.underlined &&
		!normalized.strikethrough &&
		!normalized.obfuscated
	);
};

const getLegacyColorCode = (style: MotdPreviewStyle) =>
	MOTD_COLOR_OPTIONS.find((option) => option.hex.toLowerCase() === style.color?.toLowerCase())?.legacyCode;

const serializeLegacyRuns = (runs: MotdPreviewRun[]) => {
	let output = '';
	let previousStyle = normalizeStyle();

	for (const run of mergeRuns(runs)) {
		const style = normalizeStyle(run.style);

		if (!areStylesEqual(style, previousStyle)) {
			if (isBaseStyle(style)) {
				output += `${SECTION_SIGN}r`;
			} else {
				if (!isBaseStyle(previousStyle)) {
					output += `${SECTION_SIGN}r`;
				}

				const colorCode = getLegacyColorCode(style);
				if (colorCode) {
					output += `${SECTION_SIGN}${colorCode}`;
				}

				for (const option of MOTD_DECORATION_OPTIONS) {
					if (style[option.key]) {
						output += `${SECTION_SIGN}${option.legacyCode}`;
					}
				}
			}
		}

		output += run.text;
		previousStyle = style;
	}

	return output;
};

const escapeMiniMessageText = (value: string) => value.replace(/\\/g, '\\\\').replace(/</g, '\\<');

const getMiniMessageColorTag = (style: MotdPreviewStyle) => {
	const token = style.colorToken?.trim();
	if (token) return token;

	const matchingOption = MOTD_COLOR_OPTIONS.find(
		(option) => option.hex.toLowerCase() === style.color?.toLowerCase(),
	);
	return matchingOption?.miniMessageTag ?? style.color;
};

const serializeMiniMessageRuns = (runs: MotdPreviewRun[]) =>
	mergeRuns(runs)
		.map((run) => {
			const style = normalizeStyle(run.style);
			const tags: string[] = [];

			if (run.effect?.tag) {
				tags.push(run.effect.tag);
			}

			const colorTag = getMiniMessageColorTag(style);
			if (colorTag) {
				tags.push(colorTag);
			}

			if (style.shadowToken) {
				tags.push(`shadow:${style.shadowToken}`);
			}

			for (const key of NORMALIZED_DECORATION_KEYS) {
				if (style[key]) {
					tags.push(MINI_DECORATION_TAGS[key]);
				}
			}

			const openingTags = tags.map((tag) => `<${tag}>`).join('');
			return `${openingTags}${escapeMiniMessageText(run.text)}${tags.length > 0 ? '<reset>' : ''}`;
		})
		.join('');

const serializeRuns = (runs: MotdPreviewRun[], format: MotdFormat) =>
	format === 'legacy' ? serializeLegacyRuns(runs) : serializeMiniMessageRuns(runs);

const serializeLines = (lines: MotdRichLine[], format: MotdFormat) => {
	const clampedLines = Array.from({ length: MOTD_MAX_LINES }, (_, index) =>
		clampRunsToWidth(lines[index] ?? []),
	);
	const serializedLines = clampedLines.map((line, index) => {
		const serialized = serializeRuns(line, format);
		// Re-attach the leading alignment backslash the visual editor hides, so the
		// first line's leading spaces survive back into server.properties.
		return format === 'legacy' && index === 0 ? applyMotdAlignmentEscape(serialized) : serialized;
	});

	return getRunsLength(clampedLines[1]) > 0 ? serializedLines.join('\n') : serializedLines[0];
};

const readElementStyle = (element: Element, inheritedRun: MotdPreviewRun): MotdPreviewRun => {
	const payload = parseStylePayload(element.getAttribute('data-motd-style'));
	if (element.hasAttribute('data-motd-style')) {
		return payload;
	}

	const nextRun = cloneRun(inheritedRun);
	const tagName = element.tagName.toLowerCase();

	if (tagName === 'b' || tagName === 'strong') {
		nextRun.style.bold = true;
	}

	if (tagName === 'i' || tagName === 'em') {
		nextRun.style.italic = true;
	}

	if (tagName === 'u') {
		nextRun.style.underlined = true;
	}

	if (tagName === 's' || tagName === 'strike' || tagName === 'del') {
		nextRun.style.strikethrough = true;
	}

	return nextRun;
};

const readLineRunsFromElement = (element: HTMLElement | null): MotdPreviewRun[] => {
	if (!element) return [];

	const runs: MotdPreviewRun[] = [];

	const walk = (node: Node, inheritedRun: MotdPreviewRun) => {
		if (node.nodeType === Node.TEXT_NODE) {
			appendRun(runs, {
				...cloneRun(inheritedRun),
				text: node.textContent ?? '',
			});
			return;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) return;

		const elementNode = node as Element;
		if (elementNode.tagName.toLowerCase() === 'br') return;

		const nextRun = readElementStyle(elementNode, inheritedRun);
		elementNode.childNodes.forEach((childNode) => walk(childNode, nextRun));
	};

	element.childNodes.forEach((childNode) => walk(childNode, { text: '', style: normalizeStyle() }));
	return clampRunsToWidth(runs);
};

const getLineElementForNode = (node: Node | null): HTMLElement | null => {
	if (!node) return null;

	const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
	return element?.closest<HTMLElement>('[data-motd-line]') ?? null;
};

const getLineIndex = (element: HTMLElement | null) => {
	const value = element?.dataset.motdLine;
	if (value === undefined) return -1;

	const index = Number.parseInt(value, 10);
	return Number.isFinite(index) ? index : -1;
};

const getOffsetWithinLine = (lineElement: HTMLElement, node: Node, offset: number) => {
	const range = document.createRange();
	range.selectNodeContents(lineElement);

	try {
		range.setEnd(node, offset);
		return range.toString().length;
	} catch {
		return getRunsLength(readLineRunsFromElement(lineElement));
	} finally {
		range.detach();
	}
};

const normalizeSelection = (selection: MotdEditorSelection): MotdEditorSelection => {
	const startsAfterEnd =
		selection.startLine > selection.endLine ||
		(selection.startLine === selection.endLine && selection.startOffset > selection.endOffset);

	if (!startsAfterEnd) return selection;

	return {
		startLine: selection.endLine,
		startOffset: selection.endOffset,
		endLine: selection.startLine,
		endOffset: selection.startOffset,
	};
};

const isSelectionCollapsed = (selection: MotdEditorSelection) =>
	selection.startLine === selection.endLine && selection.startOffset === selection.endOffset;

const readEditorSelection = (): MotdEditorSelection | null => {
	const selection = document.getSelection();
	if (!selection || selection.rangeCount === 0) return null;

	const anchorLine = getLineElementForNode(selection.anchorNode);
	const focusLine = getLineElementForNode(selection.focusNode);
	const anchorLineIndex = getLineIndex(anchorLine);
	const focusLineIndex = getLineIndex(focusLine);

	if (!anchorLine || !focusLine || anchorLineIndex < 0 || focusLineIndex < 0) {
		return null;
	}

	return normalizeSelection({
		startLine: anchorLineIndex,
		startOffset: getOffsetWithinLine(anchorLine, selection.anchorNode as Node, selection.anchorOffset),
		endLine: focusLineIndex,
		endOffset: getOffsetWithinLine(focusLine, selection.focusNode as Node, selection.focusOffset),
	});
};

const findTextPosition = (lineElement: HTMLElement, offset: number): { node: Node; offset: number } => {
	const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT);
	let remaining = Math.max(0, offset);
	let lastTextNode: Text | null = null;

	while (walker.nextNode()) {
		const textNode = walker.currentNode as Text;
		const length = textNode.textContent?.length ?? 0;
		lastTextNode = textNode;

		if (remaining <= length) {
			return { node: textNode, offset: remaining };
		}

		remaining -= length;
	}

	if (lastTextNode) {
		return { node: lastTextNode, offset: lastTextNode.textContent?.length ?? 0 };
	}

	return { node: lineElement, offset: 0 };
};

const sliceRuns = (runs: MotdPreviewRun[], startOffset: number, endOffset: number) => {
	const slicedRuns: MotdPreviewRun[] = [];
	let cursor = 0;

	for (const run of runs) {
		const runStart = cursor;
		const runEnd = cursor + run.text.length;
		cursor = runEnd;

		if (runEnd <= startOffset || runStart >= endOffset) continue;

		const textStart = Math.max(0, startOffset - runStart);
		const textEnd = Math.min(run.text.length, endOffset - runStart);
		appendRun(slicedRuns, {
			...cloneRun(run),
			text: run.text.slice(textStart, textEnd),
		});
	}

	return slicedRuns;
};

const replaceRunsInRange = (
	runs: MotdPreviewRun[],
	startOffset: number,
	endOffset: number,
	insertedRuns: MotdPreviewRun[],
) =>
	mergeRuns([
		...sliceRuns(runs, 0, startOffset),
		...insertedRuns.map(cloneRun),
		...sliceRuns(runs, endOffset, getRunsLength(runs)),
	]);

// Pixel budget left for inserting into a line once the runs that survive the
// replacement (everything outside [startOffset, endOffset)) are accounted for.
const availableInsertWidth = (line: MotdPreviewRun[], startOffset: number, endOffset: number) => {
	const keptWidth =
		measureMotdRunsWidth(sliceRuns(line, 0, startOffset)) +
		measureMotdRunsWidth(sliceRuns(line, endOffset, getRunsLength(line)));
	return Math.max(0, MOTD_LINE_PIXEL_BUDGET - keptWidth);
};

const clampSelectionToLines = (
	selection: MotdEditorSelection,
	lines: MotdRichLine[],
): MotdEditorSelection => {
	const startLine = Math.min(MOTD_MAX_LINES - 1, Math.max(0, selection.startLine));
	const endLine = Math.min(MOTD_MAX_LINES - 1, Math.max(0, selection.endLine));

	return {
		startLine,
		startOffset: Math.min(selection.startOffset, getRunsLength(lines[startLine] ?? [])),
		endLine,
		endOffset: Math.min(selection.endOffset, getRunsLength(lines[endLine] ?? [])),
	};
};

const getSelectedRuns = (lines: MotdRichLine[], selection: MotdEditorSelection) => {
	const normalizedSelection = normalizeSelection(selection);
	const runs: MotdPreviewRun[] = [];

	for (
		let lineIndex = normalizedSelection.startLine;
		lineIndex <= normalizedSelection.endLine;
		lineIndex += 1
	) {
		const line = lines[lineIndex] ?? [];
		const startOffset = lineIndex === normalizedSelection.startLine ? normalizedSelection.startOffset : 0;
		const endOffset =
			lineIndex === normalizedSelection.endLine ? normalizedSelection.endOffset : getRunsLength(line);
		runs.push(...sliceRuns(line, startOffset, endOffset));
	}

	return runs;
};

const transformSelectedRuns = (
	lines: MotdRichLine[],
	selection: MotdEditorSelection,
	transform: (run: MotdPreviewRun) => MotdPreviewRun,
) => {
	const nextLines = lines.map((line) => line.map(cloneRun));
	const normalizedSelection = normalizeSelection(selection);

	for (
		let lineIndex = normalizedSelection.startLine;
		lineIndex <= normalizedSelection.endLine;
		lineIndex += 1
	) {
		const line = nextLines[lineIndex] ?? [];
		const startOffset = lineIndex === normalizedSelection.startLine ? normalizedSelection.startOffset : 0;
		const endOffset =
			lineIndex === normalizedSelection.endLine ? normalizedSelection.endOffset : getRunsLength(line);

		const selectedRuns = sliceRuns(line, startOffset, endOffset).map(transform);
		nextLines[lineIndex] = replaceRunsInRange(line, startOffset, endOffset, selectedRuns);
	}

	return nextLines;
};

// A legacy color/reset code clears active formatting; `§l` turns bold on. Track
// that so the source-editor clamp honours the narrower bold line budget.
const nextLegacyBold = (bold: boolean, code: string) => {
	const lower = code.toLowerCase();
	if (lower === 'l') return true;
	if (lower === 'r' || /[0-9a-f]/.test(lower)) return false;
	return bold;
};

const clampRawLegacyLine = (line: string, isFirstLine: boolean) => {
	let output = '';
	let used = 0;
	let bold = false;

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];

		// The hidden leading alignment backslash is an escape, not visible text.
		if (
			isFirstLine &&
			index === 0 &&
			char === '\\' &&
			(line.length === 1 || line[1] === ' ' || line[1] === '\t')
		) {
			output += char;
			continue;
		}

		if (char === SECTION_SIGN && index + 1 < line.length) {
			output += `${char}${line[index + 1]}`;
			bold = nextLegacyBold(bold, line[index + 1]);
			index += 1;
			continue;
		}

		if (used >= MOTD_LINE_PIXEL_BUDGET) break;

		output += char;
		used += motdCharAdvance(char, bold);
	}

	return output;
};

const clampRawMiniMessageLine = (line: string) => {
	let output = '';
	let used = 0;
	let bold = false;

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];

		if (char === '\\' && index + 1 < line.length) {
			if (used >= MOTD_LINE_PIXEL_BUDGET) break;

			output += `${char}${line[index + 1]}`;
			used += motdCharAdvance(line[index + 1], bold);
			index += 1;
			continue;
		}

		if (char === '<') {
			const closeIndex = line.indexOf('>', index + 1);
			if (closeIndex !== -1) {
				const token = line.slice(index, closeIndex + 1);
				const tag = token.slice(1, -1).trim().toLowerCase();
				if (tag === 'bold' || tag === 'b') bold = true;
				else if (tag === '/bold' || tag === '/b' || tag === 'reset') bold = false;
				output += token;
				index = closeIndex;
				continue;
			}
		}

		if (used >= MOTD_LINE_PIXEL_BUDGET) break;

		output += char;
		used += motdCharAdvance(char, bold);
	}

	return output;
};

const clampRawSourceValue = (value: string, format: MotdFormat) =>
	value
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.slice(0, MOTD_MAX_LINES)
		.map((line, index) =>
			format === 'legacy' ? clampRawLegacyLine(line, index === 0) : clampRawMiniMessageLine(line),
		)
		.join('\n');

const createStyledInsertionRuns = (text: string, style: MotdPreviewStyle) =>
	text.replace(/\r?\n/g, '')
		? [
				{
					text: text.replace(/\r?\n/g, ''),
					style: normalizeStyle(style),
				},
			]
		: [];

const applyEditorCss = (element: HTMLElement, run: MotdPreviewRun, colorOverride?: string) => {
	const style = toEditorCss(run, colorOverride);
	element.style.color = typeof style.color === 'string' ? style.color : '';
	element.style.fontWeight = style.fontWeight ? String(style.fontWeight) : '';
	element.style.fontStyle = typeof style.fontStyle === 'string' ? style.fontStyle : '';
	element.style.textDecorationLine =
		typeof style.textDecorationLine === 'string' ? style.textDecorationLine : '';
	element.style.textShadow = typeof style.textShadow === 'string' ? style.textShadow : '';
	element.style.letterSpacing = '';
	element.style.whiteSpace = 'pre-wrap';
	element.classList.toggle('motd-obfuscated', Boolean(normalizeStyle(run.style).obfuscated));
};

const createRunSpan = (run: MotdPreviewRun, text: string, colorOverride?: string) => {
	const span = document.createElement('span');
	span.dataset.motdStyle = stylePayload(run);
	applyEditorCss(span, run, colorOverride);
	span.textContent = text;
	return span;
};

const renderRunsIntoElement = (element: HTMLElement | null, runs: MotdPreviewRun[]) => {
	if (!element) return;

	const fragment = document.createDocumentFragment();

	for (const run of runs) {
		if (run.effect) {
			const characters = run.text.split('');

			characters.forEach((char, charIndex) => {
				const span = createRunSpan(
					run,
					char,
					resolveEffectColor(run.effect as MotdPreviewEffect, charIndex, characters.length),
				);
				span.style.display = 'inline-block';
				fragment.append(span);
			});
			continue;
		}

		fragment.append(createRunSpan(run, run.text));
	}

	element.replaceChildren(fragment);
};

const decorationIcon = (key: MotdDecorationKey) => {
	if (key === 'bold') return <Bold className='size-3.5' />;
	if (key === 'italic') return <Italic className='size-3.5' />;
	if (key === 'underlined') return <Underline className='size-3.5' />;
	if (key === 'strikethrough') return <Strikethrough className='size-3.5' />;
	return <Sparkles className='size-3.5' />;
};

const MotdEditor: React.FC<MotdEditorProps> = ({
	value,
	onChange,
	format,
	advancedMode = false,
	disabled = false,
	label,
	description,
	className,
}) => {
	const lineRefs = React.useRef<Array<HTMLDivElement | null>>([]);
	const sourceRefs = React.useRef<Array<HTMLInputElement | null>>([]);
	const selectionRef = React.useRef<MotdEditorSelection | null>(null);
	const pendingSelectionRef = React.useRef<MotdEditorSelection | null>(null);
	const [activeLine, setActiveLine] = React.useState(0);
	const [activeSourceLine, setActiveSourceLine] = React.useState(0);
	const [sourceMode, setSourceMode] = React.useState(false);
	const [pendingStyle, setPendingStyle] = React.useState<MotdPreviewStyle>(() => normalizeStyle());

	React.useEffect(() => {
		if (!advancedMode) {
			setSourceMode(false);
		}
	}, [advancedMode]);

	const isLocked = disabled;
	const richLines = React.useMemo(() => getEditorLinesFromValue(value, format), [format, value]);
	const lineStats = React.useMemo(
		() =>
			richLines.map((line) => {
				const bold = lineHasBold(line);
				return {
					// Report length in "normal-character equivalents" so a bold line reads
					// out of 38 and a space-padded line counts spaces at their real width.
					used: Math.round(measureMotdRunsWidth(line) / motdCharAdvance('a', bold)),
					max: bold ? MOTD_VISUAL_LINE_WIDTH_BOLD : MOTD_VISUAL_LINE_WIDTH,
				};
			}),
		[richLines],
	);
	const sourceLines = React.useMemo(() => {
		const lines = value.replace(/\r\n?/g, '\n').split('\n');
		return [lines[0] ?? '', lines[1] ?? ''];
	}, [value]);
	const formatLabel = format === 'legacy' ? 'Legacy section codes' : 'MiniMessage';

	const readLinesFromDom = React.useCallback(
		() =>
			Array.from({ length: MOTD_MAX_LINES }, (_, index) =>
				readLineRunsFromElement(lineRefs.current[index]),
			),
		[],
	);

	const captureSelection = React.useCallback(() => {
		const selection = readEditorSelection();
		if (selection) {
			selectionRef.current = selection;
			setActiveLine(selection.endLine);
		}

		return selection;
	}, []);

	const restoreSelection = React.useCallback((selection: MotdEditorSelection) => {
		const normalizedSelection = normalizeSelection(selection);
		const startLine = lineRefs.current[normalizedSelection.startLine];
		const endLine = lineRefs.current[normalizedSelection.endLine];
		if (!startLine || !endLine) return;

		const startPosition = findTextPosition(startLine, normalizedSelection.startOffset);
		const endPosition = findTextPosition(endLine, normalizedSelection.endOffset);
		const range = document.createRange();
		range.setStart(startPosition.node, startPosition.offset);
		range.setEnd(endPosition.node, endPosition.offset);

		const browserSelection = document.getSelection();
		browserSelection?.removeAllRanges();
		browserSelection?.addRange(range);
		endLine.focus();
		selectionRef.current = normalizedSelection;
		setActiveLine(normalizedSelection.endLine);
	}, []);

	React.useLayoutEffect(() => {
		if (sourceMode) return;

		richLines.forEach((line, lineIndex) => {
			renderRunsIntoElement(lineRefs.current[lineIndex], line);
		});

		const selection = pendingSelectionRef.current;
		if (!selection) return;

		pendingSelectionRef.current = null;
		restoreSelection(clampSelectionToLines(selection, richLines));
	}, [restoreSelection, richLines, sourceMode]);

	React.useEffect(() => {
		if (sourceMode) return;

		const handleSelectionChange = () => {
			captureSelection();
		};

		document.addEventListener('selectionchange', handleSelectionChange);
		return () => document.removeEventListener('selectionchange', handleSelectionChange);
	}, [captureSelection, sourceMode]);

	const commitLines = React.useCallback(
		(lines: MotdRichLine[], selection?: MotdEditorSelection | null) => {
			const clampedLines = lines.map(clampRunsToWidth);
			const clampedSelection = selection ? clampSelectionToLines(selection, clampedLines) : null;
			clampedLines.forEach((line, lineIndex) => {
				renderRunsIntoElement(lineRefs.current[lineIndex], line);
			});
			if (clampedSelection) {
				restoreSelection(clampedSelection);
			}
			pendingSelectionRef.current = clampedSelection;
			onChange(serializeLines(clampedLines, format));
		},
		[format, onChange, restoreSelection],
	);

	const focusLine = React.useCallback(
		(lineIndex: number, offset: number) => {
			const lineLength = getRunsLength(readLineRunsFromElement(lineRefs.current[lineIndex]));
			const clampedOffset = Math.min(offset, lineLength);
			const selection = {
				startLine: lineIndex,
				startOffset: clampedOffset,
				endLine: lineIndex,
				endOffset: clampedOffset,
			};

			window.requestAnimationFrame(() => restoreSelection(selection));
		},
		[restoreSelection],
	);

	const handleRichInput = React.useCallback(() => {
		const selection = captureSelection();
		const nextLines = readLinesFromDom();
		commitLines(nextLines, selection);
	}, [captureSelection, commitLines, readLinesFromDom]);

	const insertTextAtSelection = React.useCallback(
		(text: string, style: MotdPreviewStyle = normalizeStyle()) => {
			if (isLocked || !text) return;

			const selection = captureSelection() ??
				selectionRef.current ?? {
					startLine: activeLine,
					startOffset: getRunsLength(readLineRunsFromElement(lineRefs.current[activeLine])),
					endLine: activeLine,
					endOffset: getRunsLength(readLineRunsFromElement(lineRefs.current[activeLine])),
				};
			const normalizedSelection = normalizeSelection(selection);
			const lines = readLinesFromDom();
			const textLines = text.replace(/\r\n?/g, '\n').split('\n');
			const firstText = textLines[0] ?? '';
			const secondText = textLines.slice(1).join(' ');
			const insertionStyle = normalizeStyle(style);

			if (!secondText || normalizedSelection.startLine === MOTD_MAX_LINES - 1) {
				const line = lines[normalizedSelection.startLine] ?? [];
				const available = availableInsertWidth(
					line,
					normalizedSelection.startOffset,
					normalizedSelection.endOffset,
				);
				const insertedText = sliceTextToBudget(firstText, Boolean(insertionStyle.bold), available);
				const insertedRuns = createStyledInsertionRuns(insertedText, insertionStyle);
				const nextLines = lines.map((entry) => entry.map(cloneRun));
				nextLines[normalizedSelection.startLine] = replaceRunsInRange(
					line,
					normalizedSelection.startOffset,
					normalizedSelection.endOffset,
					insertedRuns,
				);
				const nextOffset = normalizedSelection.startOffset + insertedText.length;
				commitLines(nextLines, {
					startLine: normalizedSelection.startLine,
					startOffset: nextOffset,
					endLine: normalizedSelection.startLine,
					endOffset: nextOffset,
				});
				return;
			}

			const firstLine = lines[normalizedSelection.startLine] ?? [];
			const secondLine = lines[normalizedSelection.startLine + 1] ?? [];
			const firstEnd =
				normalizedSelection.endLine === normalizedSelection.startLine
					? normalizedSelection.endOffset
					: getRunsLength(firstLine);
			const firstInserted = sliceTextToBudget(
				firstText,
				Boolean(insertionStyle.bold),
				availableInsertWidth(firstLine, normalizedSelection.startOffset, firstEnd),
			);
			const firstLineNext = replaceRunsInRange(
				firstLine,
				normalizedSelection.startOffset,
				firstEnd,
				createStyledInsertionRuns(firstInserted, insertionStyle),
			);
			const secondLineRemainder =
				normalizedSelection.endLine > normalizedSelection.startLine
					? sliceRuns(secondLine, normalizedSelection.endOffset, getRunsLength(secondLine))
					: secondLine;
			const secondInserted = sliceTextToBudget(
				secondText,
				Boolean(insertionStyle.bold),
				Math.max(0, MOTD_LINE_PIXEL_BUDGET - measureMotdRunsWidth(secondLineRemainder)),
			);
			const secondLineNext = clampRunsToWidth([
				...createStyledInsertionRuns(secondInserted, insertionStyle),
				...secondLineRemainder,
			]);
			const nextLines = lines.map((entry) => entry.map(cloneRun));
			nextLines[normalizedSelection.startLine] = firstLineNext;
			nextLines[normalizedSelection.startLine + 1] = secondLineNext;
			const nextOffset = Math.min(secondInserted.length, getRunsLength(secondLineNext));

			commitLines(nextLines, {
				startLine: normalizedSelection.startLine + 1,
				startOffset: nextOffset,
				endLine: normalizedSelection.startLine + 1,
				endOffset: nextOffset,
			});
		},
		[activeLine, captureSelection, commitLines, isLocked, readLinesFromDom],
	);

	const updateSelectedText = React.useCallback(
		(
			transform: (run: MotdPreviewRun) => MotdPreviewRun,
			fallbackStyle: (style: MotdPreviewStyle) => MotdPreviewStyle,
		) => {
			if (isLocked) return;

			const selection = captureSelection() ?? selectionRef.current;
			if (!selection || isSelectionCollapsed(selection)) {
				setPendingStyle((previous) => fallbackStyle(normalizeStyle(previous)));
				return;
			}

			const nextLines = transformSelectedRuns(readLinesFromDom(), selection, transform);
			commitLines(nextLines, selection);
		},
		[captureSelection, commitLines, isLocked, readLinesFromDom],
	);

	const applyAlignment = React.useCallback(
		(alignment: MotdAlignment) => {
			if (isLocked) return;
			onChange(applyMotdAlignment(value, format, alignment));
		},
		[format, isLocked, onChange, value],
	);

	const updateSourceLine = React.useCallback(
		(index: number, nextLine: string) => {
			if (isLocked) return;
			const lines = value.replace(/\r\n?/g, '\n').split('\n');
			const line0 = index === 0 ? nextLine : (lines[0] ?? '');
			const line1 = index === 1 ? nextLine : (lines[1] ?? '');
			const nextValue = line1.length > 0 ? `${line0}\n${line1}` : line0;
			onChange(clampRawSourceValue(nextValue, format));
		},
		[format, isLocked, onChange, value],
	);

	const insertSourceCode = React.useCallback(
		(code: string) => {
			if (isLocked) return;
			const index = activeSourceLine;
			const input = sourceRefs.current[index];
			const lineValue = value.replace(/\r\n?/g, '\n').split('\n')[index] ?? '';
			const start = input?.selectionStart ?? lineValue.length;
			const end = input?.selectionEnd ?? lineValue.length;
			updateSourceLine(index, `${lineValue.slice(0, start)}${code}${lineValue.slice(end)}`);

			const caret = start + code.length;
			window.requestAnimationFrame(() => {
				const target = sourceRefs.current[index];
				if (!target) return;
				target.focus();
				target.setSelectionRange(caret, caret);
			});
		},
		[activeSourceLine, isLocked, updateSourceLine, value],
	);

	const applyColor = React.useCallback(
		(color: { color: string; colorToken: string }) => {
			updateSelectedText(
				(run) => ({
					...cloneRun(run),
					style: {
						...normalizeStyle(run.style),
						color: color.color,
						colorToken: color.colorToken,
					},
				}),
				(style) => ({
					...style,
					color: color.color,
					colorToken: color.colorToken,
				}),
			);
		},
		[updateSelectedText],
	);

	const applyShadow = React.useCallback(
		(hex: string) => {
			updateSelectedText(
				(run) => ({
					...cloneRun(run),
					style: {
						...normalizeStyle(run.style),
						shadowColor: hex,
						shadowToken: hex,
					},
				}),
				(style) => ({
					...style,
					shadowColor: hex,
					shadowToken: hex,
				}),
			);
		},
		[updateSelectedText],
	);

	const applyDecoration = React.useCallback(
		(key: MotdDecorationKey) => {
			const selection = captureSelection() ?? selectionRef.current;
			const lines = readLinesFromDom();
			const selectedRuns =
				selection && !isSelectionCollapsed(selection) ? getSelectedRuns(lines, selection) : [];
			const shouldEnable =
				selectedRuns.length === 0 || selectedRuns.some((run) => !normalizeStyle(run.style)[key]);

			updateSelectedText(
				(run) => ({
					...cloneRun(run),
					style: {
						...normalizeStyle(run.style),
						[key]: shouldEnable,
					},
				}),
				(style) => ({
					...style,
					[key]: !style[key],
				}),
			);
		},
		[captureSelection, readLinesFromDom, updateSelectedText],
	);

	const handleBeforeInput = React.useCallback(
		(event: React.FormEvent<HTMLDivElement>) => {
			const inputEvent = event.nativeEvent as InputEvent;

			if (inputEvent.inputType === 'insertParagraph' || inputEvent.inputType === 'insertLineBreak') {
				event.preventDefault();
				focusLine(Math.min(MOTD_MAX_LINES - 1, activeLine + 1), 0);
				return;
			}

			if (!inputEvent.data || !inputEvent.inputType.startsWith('insert')) return;

			const selection = captureSelection() ?? selectionRef.current;
			if (!selection || selection.startLine !== selection.endLine) return;

			const line = readLineRunsFromElement(lineRefs.current[selection.startLine]);
			const available = availableInsertWidth(line, selection.startOffset, selection.endOffset);
			const text = sliceTextToBudget(inputEvent.data, Boolean(pendingStyle.bold), available);

			if (available <= 0 || text.length < inputEvent.data.length || !isBaseStyle(pendingStyle)) {
				event.preventDefault();
				insertTextAtSelection(text, pendingStyle);
			}
		},
		[activeLine, captureSelection, focusLine, insertTextAtSelection, pendingStyle],
	);

	const handleLineKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>, lineIndex: number) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				focusLine(Math.min(MOTD_MAX_LINES - 1, lineIndex + 1), 0);
				return;
			}

			if (event.key === 'ArrowDown' && lineIndex < MOTD_MAX_LINES - 1) {
				const selection = captureSelection() ?? selectionRef.current;
				const offset = selection?.endOffset ?? 0;
				event.preventDefault();
				focusLine(lineIndex + 1, offset);
				return;
			}

			if (event.key === 'ArrowUp' && lineIndex > 0) {
				const selection = captureSelection() ?? selectionRef.current;
				const offset = selection?.endOffset ?? 0;
				event.preventDefault();
				focusLine(lineIndex - 1, offset);
				return;
			}

			if (event.key === 'Backspace' && lineIndex > 0) {
				const selection = captureSelection() ?? selectionRef.current;
				if (selection && isSelectionCollapsed(selection) && selection.startOffset === 0) {
					event.preventDefault();
					focusLine(
						lineIndex - 1,
						getRunsLength(readLineRunsFromElement(lineRefs.current[lineIndex - 1])),
					);
				}
			}
		},
		[captureSelection, focusLine],
	);

	const handlePaste = React.useCallback(
		(event: React.ClipboardEvent<HTMLDivElement>) => {
			event.preventDefault();
			insertTextAtSelection(event.clipboardData.getData('text/plain'), pendingStyle);
		},
		[insertTextAtSelection, pendingStyle],
	);

	// In source mode the toolbar inserts the raw code at the caret; in the visual
	// editor it restyles the current selection.
	const handleColorOption = React.useCallback(
		(option: (typeof MOTD_COLOR_OPTIONS)[number]) => {
			if (sourceMode) {
				insertSourceCode(
					format === 'legacy' ? `${SECTION_SIGN}${option.legacyCode}` : `<${option.miniMessageTag}>`,
				);
				return;
			}
			applyColor({
				color: option.hex,
				colorToken: format === 'legacy' ? option.legacyCode : option.miniMessageTag,
			});
		},
		[applyColor, format, insertSourceCode, sourceMode],
	);

	const handleDecorationOption = React.useCallback(
		(option: (typeof MOTD_DECORATION_OPTIONS)[number]) => {
			if (sourceMode) {
				insertSourceCode(
					format === 'legacy' ? `${SECTION_SIGN}${option.legacyCode}` : `<${option.miniMessageTag}>`,
				);
				return;
			}
			applyDecoration(option.key);
		},
		[applyDecoration, format, insertSourceCode, sourceMode],
	);

	const handleCustomColorChange = React.useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			if (sourceMode) {
				insertSourceCode(`<${event.target.value}>`);
				return;
			}
			applyColor({ color: event.target.value, colorToken: event.target.value });
		},
		[applyColor, insertSourceCode, sourceMode],
	);

	const handleShadowChange = React.useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			if (sourceMode) {
				insertSourceCode(`<shadow:${event.target.value}>`);
				return;
			}
			applyShadow(event.target.value);
		},
		[applyShadow, insertSourceCode, sourceMode],
	);

	const toolbarMouseDown = React.useCallback((event: React.MouseEvent) => {
		event.preventDefault();
	}, []);

	return (
		<div className={cn('space-y-4 max-w-3xl', className)}>
			<div className='space-y-1'>
				<p className='text-xl font-semibold'>{label}</p>
				<p className='text-sm text-muted-foreground'>{description}</p>
			</div>

			<div className='flex flex-wrap items-center justify-between gap-3 text-xs'>
				<div className='flex flex-wrap items-center gap-2'>
					<Container className='px-3 py-1'>{formatLabel}</Container>
					<Container className='px-3 py-1'>
						Line lengths{'  '}
						<span className='font-bold'>
							{lineStats.map((stat) => `${stat.used}/${stat.max}`).join('  ')}
						</span>
					</Container>
				</div>
				{advancedMode && (
					<Container className='p-0 flex items-center overflow-hidden'>
						<div
							className={cn(
								'flex items-center gap-1 px-2 py-1 cursor-pointer',
								!sourceMode && 'bg-accent text-accent-foreground',
							)}
							onMouseDown={toolbarMouseDown}
							onClick={() => setSourceMode(false)}>
							<Type className='size-3.5' /> Editor
						</div>
						<div
							className={cn(
								'flex items-center gap-1 px-2 py-1 cursor-pointer',
								sourceMode && 'bg-accent text-accent-foreground',
							)}
							onMouseDown={toolbarMouseDown}
							onClick={() => setSourceMode(true)}>
							<Sparkles className='size-3.5' /> Source
						</div>
					</Container>
				)}
			</div>

			<div className='space-y-3'>
				<div className='flex flex-wrap items-center gap-2'>
					<ButtonGroup>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type='button'
									variant='secondary'
									size='icon-xs'
									onMouseDown={toolbarMouseDown}
									onClick={() => applyAlignment('left')}
									disabled={isLocked}
									aria-label='Align left'>
									<AlignLeft className='size-3.5' />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Align left</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type='button'
									variant='secondary'
									size='icon-xs'
									onMouseDown={toolbarMouseDown}
									onClick={() => applyAlignment('center')}
									disabled={isLocked}
									aria-label='Align center'>
									<AlignCenter className='size-3.5' />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Align center</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type='button'
									variant='secondary'
									size='icon-xs'
									onMouseDown={toolbarMouseDown}
									onClick={() => applyAlignment('right')}
									disabled={isLocked}
									aria-label='Align right'>
									<AlignRight className='size-3.5' />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Align right</TooltipContent>
						</Tooltip>
					</ButtonGroup>

					<ButtonGroup>
						{MOTD_DECORATION_OPTIONS.map((option) => (
							<Tooltip key={option.label}>
								<TooltipTrigger asChild>
									<Button
										type='button'
										variant={!sourceMode && pendingStyle[option.key] ? 'default' : 'secondary'}
										size='icon-xs'
										onMouseDown={toolbarMouseDown}
										onClick={() => handleDecorationOption(option)}
										disabled={isLocked}
										aria-label={option.label}>
										{decorationIcon(option.key)}
									</Button>
								</TooltipTrigger>
								<TooltipContent>{option.label}</TooltipContent>
							</Tooltip>
						))}
					</ButtonGroup>

					{format === 'minimessage' && (
						<div className='flex items-center gap-2 rounded-md border-2 px-2 py-1'>
							<Palette className='size-4 text-muted-foreground' />
							<input
								type='color'
								className='size-7 rounded-md border-0 bg-transparent p-0'
								onChange={handleCustomColorChange}
								disabled={isLocked}
								aria-label='Custom text color'
							/>
						</div>
					)}

					{format === 'minimessage' && (
						<div className='flex items-center gap-2 rounded-md border-2 px-2 py-1'>
							<Paintbrush className='size-4 text-muted-foreground' />
							<input
								type='color'
								className='size-7 rounded-md border-0 bg-transparent p-0'
								onChange={handleShadowChange}
								disabled={isLocked}
								aria-label='Text shadow color'
							/>
						</div>
					)}
				</div>

				<div className='grid w-fit grid-cols-8 gap-1'>
					{MOTD_COLOR_OPTIONS.map((option) => (
						<Tooltip key={option.label}>
							<TooltipTrigger asChild>
								<Button
									type='button'
									variant='outline'
									size='icon-xs'
									aria-label={option.label}
									className='border-border p-0'
									style={{ backgroundColor: option.hex, color: '#000' }}
									onMouseDown={toolbarMouseDown}
									onClick={() => handleColorOption(option)}
									disabled={isLocked}>
									<span className='sr-only'>{option.label}</span>
								</Button>
							</TooltipTrigger>
							<TooltipContent>{option.label}</TooltipContent>
						</Tooltip>
					))}
				</div>

				<div
					className={cn(
						'overflow-hidden rounded-lg border-2 bg-background shadow-xs transition-colors focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
						isLocked && 'opacity-60',
					)}>
					{!sourceMode
						? richLines.map((_, lineIndex) => (
								<div
									key={`motd-line-${lineIndex}`}
									ref={(node) => {
										lineRefs.current[lineIndex] = node;
									}}
									data-motd-line={lineIndex}
									role='textbox'
									aria-label={`${label} line ${lineIndex + 1}`}
									aria-multiline='false'
									contentEditable={!isLocked}
									suppressContentEditableWarning
									spellCheck={false}
									data-placeholder={
										lineIndex === 0 ? 'Server message line 1' : 'Server message line 2'
									}
									className={cn(
										'min-h-12 px-4 py-3 font-minecraft text-sm leading-6 whitespace-pre-wrap outline-none empty:before:text-muted-foreground/55 empty:before:content-[attr(data-placeholder)]',
										lineIndex === 0 && 'border-b-2',
										activeLine === lineIndex && 'bg-muted/30',
										isLocked ? 'cursor-not-allowed' : 'cursor-text',
									)}
									onBeforeInput={handleBeforeInput}
									onInput={handleRichInput}
									onFocus={() => {
										setActiveLine(lineIndex);
										window.requestAnimationFrame(captureSelection);
									}}
									onMouseUp={captureSelection}
									onKeyUp={captureSelection}
									onKeyDown={(event) => handleLineKeyDown(event, lineIndex)}
									onPaste={handlePaste}
								/>
							))
						: sourceLines.map((line, lineIndex) => (
								<input
									key={`motd-source-line-${lineIndex}`}
									ref={(node) => {
										sourceRefs.current[lineIndex] = node;
									}}
									type='text'
									value={line}
									spellCheck={false}
									disabled={isLocked}
									aria-label={`${label} source line ${lineIndex + 1}`}
									placeholder={
										lineIndex === 0
											? 'Server message line 1 (codes shown)'
											: 'Server message line 2 (codes shown)'
									}
									className={cn(
										'block w-full min-h-12 px-4 py-3 font-mono text-sm leading-6 bg-transparent outline-none placeholder:text-muted-foreground/55',
										lineIndex === 0 && 'border-b-2',
										activeSourceLine === lineIndex && 'bg-muted/30',
										isLocked ? 'cursor-not-allowed' : 'cursor-text',
									)}
									onFocus={() => setActiveSourceLine(lineIndex)}
									onChange={(event) => updateSourceLine(lineIndex, event.target.value)}
								/>
							))}
				</div>
			</div>
		</div>
	);
};

export default MotdEditor;
