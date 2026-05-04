export type MotdFormat = 'legacy' | 'minimessage';

export type MotdAlignment = 'left' | 'center' | 'right';

export type MotdDecorationKey = 'bold' | 'italic' | 'underlined' | 'strikethrough' | 'obfuscated';

export type MotdPreviewEffect = {
	type: 'gradient' | 'rainbow' | 'transition';
	colors: string[];
	phase: number;
	reverse: boolean;
};

export type MotdPreviewStyle = {
	color?: string;
	shadowColor?: string;
	bold?: boolean;
	italic?: boolean;
	underlined?: boolean;
	strikethrough?: boolean;
	obfuscated?: boolean;
};

export type MotdPreviewRun = {
	text: string;
	style: MotdPreviewStyle;
	effect?: MotdPreviewEffect;
};

export type MotdPreviewLine = MotdPreviewRun[];

export const MOTD_MAX_LINES = 2;
export const MOTD_VISUAL_LINE_WIDTH = 59;

export const MOTD_COLOR_OPTIONS = [
	{ label: 'Black', legacyCode: '0', miniMessageTag: 'black', hex: '#000000' },
	{ label: 'Dark blue', legacyCode: '1', miniMessageTag: 'dark_blue', hex: '#0000aa' },
	{ label: 'Dark green', legacyCode: '2', miniMessageTag: 'dark_green', hex: '#00aa00' },
	{ label: 'Dark aqua', legacyCode: '3', miniMessageTag: 'dark_aqua', hex: '#00aaaa' },
	{ label: 'Dark red', legacyCode: '4', miniMessageTag: 'dark_red', hex: '#aa0000' },
	{ label: 'Dark purple', legacyCode: '5', miniMessageTag: 'dark_purple', hex: '#aa00aa' },
	{ label: 'Gold', legacyCode: '6', miniMessageTag: 'gold', hex: '#ffaa00' },
	{ label: 'Gray', legacyCode: '7', miniMessageTag: 'gray', hex: '#aaaaaa' },
	{ label: 'Dark gray', legacyCode: '8', miniMessageTag: 'dark_gray', hex: '#555555' },
	{ label: 'Blue', legacyCode: '9', miniMessageTag: 'blue', hex: '#5555ff' },
	{ label: 'Green', legacyCode: 'a', miniMessageTag: 'green', hex: '#55ff55' },
	{ label: 'Aqua', legacyCode: 'b', miniMessageTag: 'aqua', hex: '#55ffff' },
	{ label: 'Red', legacyCode: 'c', miniMessageTag: 'red', hex: '#ff5555' },
	{ label: 'Light purple', legacyCode: 'd', miniMessageTag: 'light_purple', hex: '#ff55ff' },
	{ label: 'Yellow', legacyCode: 'e', miniMessageTag: 'yellow', hex: '#ffff55' },
	{ label: 'White', legacyCode: 'f', miniMessageTag: 'white', hex: '#ffffff' },
] as const;

export const MOTD_DECORATION_OPTIONS = [
	{ label: 'Bold', legacyCode: 'l', miniMessageTag: 'bold', key: 'bold' as const },
	{ label: 'Italic', legacyCode: 'o', miniMessageTag: 'italic', key: 'italic' as const },
	{ label: 'Underline', legacyCode: 'n', miniMessageTag: 'underlined', key: 'underlined' as const },
	{ label: 'Strikethrough', legacyCode: 'm', miniMessageTag: 'strikethrough', key: 'strikethrough' as const },
	{ label: 'Obfuscated', legacyCode: 'k', miniMessageTag: 'obfuscated', key: 'obfuscated' as const },
] as const;

type RgbColor = { r: number; g: number; b: number };

const LEGACY_COLOR_CODES: Record<string, string> = {
	'0': '#000000',
	'1': '#0000aa',
	'2': '#00aa00',
	'3': '#00aaaa',
	'4': '#aa0000',
	'5': '#aa00aa',
	'6': '#ffaa00',
	'7': '#aaaaaa',
	'8': '#555555',
	'9': '#5555ff',
	a: '#55ff55',
	b: '#55ffff',
	c: '#ff5555',
	d: '#ff55ff',
	e: '#ffff55',
	f: '#ffffff',
};

const DECORATION_CODES: Record<string, MotdDecorationKey> = {
	l: 'bold',
	o: 'italic',
	n: 'underlined',
	m: 'strikethrough',
	k: 'obfuscated',
};

const MINI_MESSAGE_COLOR_CODES: Record<string, string> = {
	black: '#000000',
	dark_blue: '#0000aa',
	dark_green: '#00aa00',
	dark_aqua: '#00aaaa',
	dark_red: '#aa0000',
	dark_purple: '#aa00aa',
	gold: '#ffaa00',
	gray: '#aaaaaa',
	dark_gray: '#555555',
	blue: '#5555ff',
	green: '#55ff55',
	aqua: '#55ffff',
	red: '#ff5555',
	light_purple: '#ff55ff',
	yellow: '#ffff55',
	white: '#ffffff',
	dark_grey: '#555555',
	grey: '#aaaaaa',
};

const MINI_MESSAGE_COLOR_ALIASES = new Set([
	'black',
	'dark_blue',
	'dark_green',
	'dark_aqua',
	'dark_red',
	'dark_purple',
	'gold',
	'gray',
	'dark_gray',
	'blue',
	'green',
	'aqua',
	'red',
	'light_purple',
	'yellow',
	'white',
	'dark_grey',
	'grey',
]);

const MOTD_TAG_RE = /<[^>]+>|[^<]+/g;

const normalizeLineBreaks = (value: string) => value.replace(/\r\n?/g, '\n');

const cloneStyle = (style: MotdPreviewStyle): MotdPreviewStyle => ({ ...style });

const baseStyle = (): MotdPreviewStyle => ({
	color: undefined,
	shadowColor: undefined,
	bold: false,
	italic: false,
	underlined: false,
	strikethrough: false,
	obfuscated: false,
});

const hexToRgb = (value: string): RgbColor | null => {
	const normalized = value.trim().replace(/^#/, '');
	if (!/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(normalized)) {
		return null;
	}

	return {
		r: Number.parseInt(normalized.slice(0, 2), 16),
		g: Number.parseInt(normalized.slice(2, 4), 16),
		b: Number.parseInt(normalized.slice(4, 6), 16),
	};
};

const rgbaToCss = (value: RgbColor, alpha: number) => `rgba(${value.r}, ${value.g}, ${value.b}, ${alpha})`;

const resolveShadowColor = (value: string | undefined, alpha = 0.25): string | undefined => {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase();
	if (!normalized) return undefined;

	if (normalized.startsWith('#')) {
		const hex = normalized.replace(/^#/, '');
		if (/^[0-9a-f]{8}$/i.test(hex)) {
			const rgb = hexToRgb(hex.slice(0, 6));
			const parsedAlpha = Number.parseInt(hex.slice(6, 8), 16) / 255;
			return rgb ? rgbaToCss(rgb, parsedAlpha) : undefined;
		}

		const rgb = hexToRgb(hex);
		return rgb ? rgbaToCss(rgb, alpha) : undefined;
	}

	const rgb = hexToRgb(MINI_MESSAGE_COLOR_CODES[normalized] ?? LEGACY_COLOR_CODES[normalized] ?? '');
	return rgb ? rgbaToCss(rgb, alpha) : undefined;
};

const normalizeColorToken = (value: string | undefined): string | undefined => {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (trimmed.startsWith('#')) {
		const normalized = trimmed.length === 7 || trimmed.length === 9 ? trimmed : undefined;
		return normalized?.toLowerCase();
	}

	const named = MINI_MESSAGE_COLOR_CODES[trimmed.toLowerCase()] ?? LEGACY_COLOR_CODES[trimmed.toLowerCase()];
	return named?.toLowerCase();
};

const getActiveEffect = (stack: Array<{ kind: string; effect?: MotdPreviewEffect }>) => {
	for (let index = stack.length - 1; index >= 0; index -= 1) {
		if (stack[index].effect) return stack[index].effect;
	}

	return undefined;
};

const popMatchingFrame = (
	stack: Array<{ kind: string; style: MotdPreviewStyle; effect?: MotdPreviewEffect }>,
	matcher: (kind: string) => boolean,
) => {
	for (let index = stack.length - 1; index > 0; index -= 1) {
		if (matcher(stack[index].kind)) {
			stack.splice(index);
			return;
		}
	}
};

export const decodeLegacyMotdText = (value: string) => normalizeLineBreaks(value).replace(/\\u00a7/gi, '§');

export const encodeLegacyMotdText = (value: string) => decodeLegacyMotdText(value).replace(/§/g, '\\u00A7');

export const clampMotdLines = (value: string, maxLines = MOTD_MAX_LINES) =>
	normalizeLineBreaks(value)
		.split('\n')
		.slice(0, maxLines)
		.join('\n');

export const getEditableMotdValue = (value: string, format: MotdFormat) =>
	clampMotdLines(format === 'legacy' ? decodeLegacyMotdText(value) : normalizeLineBreaks(value));

export const getStoredMotdValue = (value: string, format: MotdFormat) => {
	const clamped = clampMotdLines(normalizeLineBreaks(value));
	return format === 'legacy' ? encodeLegacyMotdText(clamped) : clamped;
};

const parseLegacyPreviewLine = (line: string): MotdPreviewLine => {
	const runs: MotdPreviewRun[] = [];
	let style = baseStyle();
	let buffer = '';

	const flush = () => {
		if (!buffer) return;
		runs.push({ text: buffer, style: cloneStyle(style) });
		buffer = '';
	};

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (char === '§' && index + 1 < line.length) {
			const code = line[index + 1].toLowerCase();
			const color = LEGACY_COLOR_CODES[code];
			if (color) {
				flush();
				style = {
					color,
					shadowColor: style.shadowColor,
					bold: false,
					italic: false,
					underlined: false,
					strikethrough: false,
					obfuscated: false,
				};
				index += 1;
				continue;
			}

			if (code === 'r') {
				flush();
				style = baseStyle();
				index += 1;
				continue;
			}

			const decoration = DECORATION_CODES[code];
			if (decoration) {
				flush();
				style = { ...style, [decoration]: true };
				index += 1;
				continue;
			}
		}

		buffer += char;
	}

	flush();
	return runs;
};

const parseMiniMessageEffect = (tagName: string, args: string[]): MotdPreviewEffect | null => {
	if (tagName === 'rainbow' || tagName === 'pride') {
		const first = args[0] ?? '';
		const reverse = first.includes('!');
		const phase = Number.parseFloat(first.replace('!', ''));
		return {
			type: 'rainbow',
			colors: [],
			phase: Number.isFinite(phase) ? phase : 0,
			reverse,
		};
	}

	if (tagName === 'gradient' || tagName === 'transition') {
		const maybePhase = args[args.length - 1];
		const hasPhase = maybePhase !== undefined && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(maybePhase);
		const phase = hasPhase ? Number.parseFloat(maybePhase ?? '0') : 0;
		const colors = (hasPhase ? args.slice(0, -1) : args)
			.map((entry) => normalizeColorToken(entry))
			.filter((entry): entry is string => Boolean(entry));

		return {
			type: tagName,
			colors: colors.length > 0 ? colors : ['#ffffff'],
			phase: Number.isFinite(phase) ? phase : 0,
			reverse: false,
		};
	}

	return null;
};

const parseMiniMessageOpeningTag = (
	tag: string,
):
	| { kind: 'color'; style: MotdPreviewStyle }
	| { kind: 'shadow'; style: MotdPreviewStyle }
	| { kind: MotdDecorationKey; style: MotdPreviewStyle }
	| { kind: 'effect'; style: MotdPreviewStyle; effect: MotdPreviewEffect }
	| null => {
	const lower = tag.trim().toLowerCase();
	if (!lower) return null;

	const parts = lower.split(':');
	const name = parts[0];
	const args = parts.slice(1);

	if (name === 'color' || name === 'colour' || name === 'c') {
		const color = normalizeColorToken(args[0]);
		return color ? { kind: 'color', style: { color } } : null;
	}

	if (name.startsWith('#')) {
		const color = normalizeColorToken(name);
		return color ? { kind: 'color', style: { color } } : null;
	}

	if (MINI_MESSAGE_COLOR_ALIASES.has(name)) {
		const color = normalizeColorToken(name);
		return color ? { kind: 'color', style: { color } } : null;
	}

	if (name === 'shadow') {
		const color = resolveShadowColor(args[0], args[1] ? Number.parseFloat(args[1]) : 0.25);
		return color ? { kind: 'shadow', style: { shadowColor: color } } : null;
	}

	if (name === '!shadow') {
		return { kind: 'shadow', style: { shadowColor: undefined } };
	}

	if (name === 'bold' || name === 'b') {
		return { kind: 'bold', style: { bold: true } };
	}

	if (name === 'italic' || name === 'i' || name === 'em') {
		return { kind: 'italic', style: { italic: true } };
	}

	if (name === 'underlined' || name === 'u') {
		return { kind: 'underlined', style: { underlined: true } };
	}

	if (name === 'strikethrough' || name === 'st') {
		return { kind: 'strikethrough', style: { strikethrough: true } };
	}

	if (name === 'obfuscated' || name === 'obf') {
		return { kind: 'obfuscated', style: { obfuscated: true } };
	}

	const effect = parseMiniMessageEffect(name, args);
	if (effect) {
		return { kind: 'effect', style: {}, effect };
	}

	return null;
};

const closeMiniMessageFrame = (
	stack: Array<{ kind: string; style: MotdPreviewStyle; effect?: MotdPreviewEffect }>,
	name: string,
) => {
	if (name === 'reset') {
		stack.splice(1);
		return;
	}

	if (name === 'color' || name === 'colour' || name === 'c' || MINI_MESSAGE_COLOR_ALIASES.has(name)) {
		popMatchingFrame(stack, (kind) => kind === 'color');
		return;
	}

	if (name === 'shadow') {
		popMatchingFrame(stack, (kind) => kind === 'shadow');
		return;
	}

	if (name === 'bold' || name === 'b' || name === 'italic' || name === 'i' || name === 'em') {
		popMatchingFrame(stack, (kind) => kind === 'bold' || kind === 'italic');
		return;
	}

	if (name === 'underlined' || name === 'u') {
		popMatchingFrame(stack, (kind) => kind === 'underlined');
		return;
	}

	if (name === 'strikethrough' || name === 'st') {
		popMatchingFrame(stack, (kind) => kind === 'strikethrough');
		return;
	}

	if (name === 'obfuscated' || name === 'obf') {
		popMatchingFrame(stack, (kind) => kind === 'obfuscated');
		return;
	}

	if (name === 'gradient' || name === 'transition' || name === 'rainbow' || name === 'pride') {
		popMatchingFrame(stack, (kind) => kind === 'effect');
	}
};

const parseMiniMessagePreviewLine = (line: string): MotdPreviewLine => {
	const runs: MotdPreviewRun[] = [];
	const stack: Array<{ kind: string; style: MotdPreviewStyle; effect?: MotdPreviewEffect }> = [
		{ kind: 'base', style: baseStyle() },
	];
	let buffer = '';

	const flush = () => {
		if (!buffer) return;
		runs.push({
			text: buffer,
			style: cloneStyle(stack[stack.length - 1].style),
			effect: getActiveEffect(stack),
		});
		buffer = '';
	};

	const tokens = line.match(MOTD_TAG_RE) ?? [];
	for (const token of tokens) {
		if (token.startsWith('<') && token.endsWith('>')) {
			const rawTag = token.slice(1, -1).trim();
			const lower = rawTag.toLowerCase();

			if (!lower) continue;

			if (lower === 'reset') {
				flush();
				stack.splice(1);
				stack[0] = { kind: 'base', style: baseStyle() };
				continue;
			}

			if (lower === 'newline' || lower === 'br') {
				buffer += '\n';
				continue;
			}

			if (lower.startsWith('/')) {
				flush();
				closeMiniMessageFrame(stack, lower.slice(1).split(':')[0].trim());
				continue;
			}

			const parsed = parseMiniMessageOpeningTag(rawTag);
			if (parsed) {
				flush();
				if (parsed.kind === 'effect') {
					stack.push({
						kind: 'effect',
						style: cloneStyle(stack[stack.length - 1].style),
						effect: parsed.effect,
					});
				} else {
					stack.push({
						kind: parsed.kind,
						style: { ...stack[stack.length - 1].style, ...parsed.style },
					});
				}
				continue;
			}

			continue;
		}

		buffer += token;
	}

	flush();
	return runs;
};

export const parseMotdPreviewLines = (value: string, format: MotdFormat): MotdPreviewLine[] => {
	const normalized = format === 'legacy' ? decodeLegacyMotdText(value) : value;
	const previewValue = format === 'minimessage' ? normalized.replace(/<\s*(?:newline|br)\s*>/gi, '\n') : normalized;
	return clampMotdLines(previewValue)
		.split('\n')
		.map((line) => (format === 'legacy' ? parseLegacyPreviewLine(line) : parseMiniMessagePreviewLine(line)));
};

export const stripMotdFormatting = (value: string, format: MotdFormat) =>
	parseMotdPreviewLines(value, format)
		.map((line) => line.map((run) => run.text).join(''))
		.join('\n');

export const getMotdVisibleLineLengths = (value: string, format: MotdFormat) =>
	clampMotdLines(value)
		.split('\n')
		.map((line) => stripMotdFormatting(line, format).length);

export const applyMotdAlignment = (value: string, format: MotdFormat, alignment: MotdAlignment) =>
	clampMotdLines(value)
		.split('\n')
		.map((line) => {
			const trimmedLine = line.replace(/^\s+/, '');
			if (!trimmedLine) return '';

			const visibleLength = stripMotdFormatting(trimmedLine, format).length;
			const padding = Math.max(0, MOTD_VISUAL_LINE_WIDTH - visibleLength);
			const prefixSpaces =
				alignment === 'center' ? Math.floor(padding / 2) : alignment === 'right' ? padding : 0;
			return `${' '.repeat(prefixSpaces)}${trimmedLine}`;
		})
		.join('\n');
