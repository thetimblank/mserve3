import * as React from 'react';
import { ChevronLeft, ChevronRight, Palette, Paintbrush, Sparkles, Type } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
	applyMotdAlignment,
	getMotdVisibleLineLengths,
	MOTD_COLOR_OPTIONS,
	MOTD_DECORATION_OPTIONS,
	MOTD_VISUAL_LINE_WIDTH,
	parseMotdPreviewLines,
	type MotdAlignment,
	type MotdFormat,
	type MotdPreviewEffect,
	type MotdPreviewLine,
	type MotdPreviewRun,
} from '@/lib/motd-format';

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

const OBFUSCATED_POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{};:,.?/';

const toPreviewStyle = (run: MotdPreviewRun): React.CSSProperties => {
	const decorationLines = [run.style.underlined ? 'underline' : null, run.style.strikethrough ? 'line-through' : null]
		.filter(Boolean)
		.join(' ');

	return {
		color: run.style.color,
		fontWeight: run.style.bold ? 700 : 400,
		fontStyle: run.style.italic ? 'italic' : 'normal',
		textDecorationLine: decorationLines || undefined,
		textShadow: run.style.shadowColor ? `0 0 0.15em ${run.style.shadowColor}, 0.05em 0.05em 0 ${run.style.shadowColor}` : undefined,
		letterSpacing: run.style.obfuscated ? '0.08em' : undefined,
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

const mixRgb = (left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }, t: number) => ({
	r: Math.round(left.r + (right.r - left.r) * t),
	g: Math.round(left.g + (right.g - left.g) * t),
	b: Math.round(left.b + (right.b - left.b) * t),
});

const resolveEffectColor = (effect: MotdPreviewEffect, index: number, total: number) => {
	const progress = total <= 1 ? 0 : index / (total - 1);
	const shiftedProgress = ((progress + effect.phase) % 1 + 1) % 1;

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

const ObfuscatedText: React.FC<{ value: string; style: React.CSSProperties }> = ({ value, style }) => {
	const [tick, setTick] = React.useState(0);

	React.useEffect(() => {
		const intervalId = window.setInterval(() => {
			setTick((previous) => previous + 1);
		}, 120);

		return () => window.clearInterval(intervalId);
	}, []);

	const displayValue = React.useMemo(
		() =>
			value
				.split('')
				.map((char, index) => {
					if (char === ' ') return ' ';
					const poolIndex = (index + tick) % OBFUSCATED_POOL.length;
					return OBFUSCATED_POOL[poolIndex];
				})
				.join(''),
		[value, tick],
	);

	return <span style={style}>{displayValue}</span>;
};

const PreviewRun: React.FC<{ run: MotdPreviewRun }> = ({ run }) => {
	const style = toPreviewStyle(run);

	if (run.effect) {
		const characters = run.text.split('');
		if (characters.length === 0) {
			return null;
		}

		return (
			<>
				{characters.map((char, index) => (
					<span
						key={`${char}-${index}`}
						style={{
							...style,
							color: resolveEffectColor(run.effect as MotdPreviewEffect, index, characters.length),
							display: 'inline-block',
						}}>
						{char}
					</span>
				))}
			</>
		);
	}

	if (run.style.obfuscated) {
		return <ObfuscatedText value={run.text} style={style} />;
	}

	return <span style={style}>{run.text}</span>;
};

const MotdPreview: React.FC<{ value: string; format: MotdFormat }> = ({ value, format }) => {
	const lines = React.useMemo<MotdPreviewLine[]>(() => parseMotdPreviewLines(value, format), [format, value]);

	return (
		<div className='rounded-xl border-2 bg-neutral-950 p-4 shadow-inner shadow-black/30'>
			<div className='mb-3 flex items-center justify-between gap-4 text-xs text-neutral-400'>
				<span className='inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-medium text-neutral-200'>
					<Palette className='size-3.5' />
					Server list preview
				</span>
				<span>59 columns per line</span>
			</div>
			<div className='space-y-1 rounded-lg bg-black/20 px-4 py-3 font-minecraft text-sm leading-6 text-white'>
				{lines.length > 0 ? (
					lines.map((line, lineIndex) => (
						<div key={`motd-preview-line-${lineIndex}`} className='min-h-6 whitespace-pre-wrap'>
							{line.length > 0 ? line.map((run, runIndex) => <PreviewRun key={`${lineIndex}-${runIndex}`} run={run} />) : '\u00a0'}
						</div>
					))
				) : (
					<div className='text-white/50'>Your MOTD preview will appear here.</div>
				)}
			</div>
		</div>
	);
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
	const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
	const pendingSelectionRef = React.useRef<{ start: number; end: number } | null>(null);
	const [sourceMode, setSourceMode] = React.useState(false);

	React.useEffect(() => {
		if (!advancedMode) {
			setSourceMode(false);
		}
	}, [advancedMode]);

	React.useEffect(() => {
		const pendingSelection = pendingSelectionRef.current;
		const textarea = textareaRef.current;
		if (!pendingSelection || !textarea) return;

		textarea.focus();
		textarea.setSelectionRange(pendingSelection.start, pendingSelection.end);
		pendingSelectionRef.current = null;
	}, [value]);

	const isLocked = disabled;
	const visibleLengths = React.useMemo(() => getMotdVisibleLineLengths(value, format), [format, value]);
	const formatLabel = format === 'legacy' ? 'Legacy section codes' : 'MiniMessage';

	const commitValue = React.useCallback(
		(nextValue: string, selection?: { start: number; end: number }) => {
			const normalized = nextValue.replace(/\r\n?/g, '\n').split('\n').slice(0, 2).join('\n');
			pendingSelectionRef.current = selection ?? null;
			onChange(normalized);
		},
		[onChange],
	);

	const updateValueAtSelection = React.useCallback(
		(transform: (context: { before: string; selected: string; after: string }) => { value: string; selection?: { start: number; end: number } }) => {
			if (isLocked) return;
			const textarea = textareaRef.current;
			if (!textarea) return;

			const start = textarea.selectionStart ?? value.length;
			const end = textarea.selectionEnd ?? start;
			const before = value.slice(0, start);
			const selected = value.slice(start, end);
			const after = value.slice(end);
			const next = transform({ before, selected, after });
			commitValue(next.value, next.selection);
		},
		[commitValue, isLocked, value],
	);

	const applyAlignment = React.useCallback(
		(alignment: MotdAlignment) => {
			if (isLocked) return;
			commitValue(applyMotdAlignment(value, format, alignment));
		},
		[commitValue, format, isLocked, value],
	);

	const applyLegacyCode = React.useCallback(
		(code: string) => {
			if (format !== 'legacy') return;
			updateValueAtSelection(({ before, selected, after }) => {
				if (!selected) {
					const nextValue = `${before}§${code}${after}`;
					return {
						value: nextValue,
						selection: { start: before.length + 2, end: before.length + 2 },
					};
				}

				const insertion = `§${code}${selected}§r`;
				const cursor = before.length + 2 + selected.length + 2;
				return {
					value: `${before}${insertion}${after}`,
					selection: { start: cursor, end: cursor },
				};
			});
		},
		[format, updateValueAtSelection],
	);

	const applyMiniMessageColor = React.useCallback(
		(tag: string) => {
			if (format !== 'minimessage') return;
			wrapSelection(`<${tag}>`, '<reset>', true);
		},
		[format],
	);

	const wrapSelection = React.useCallback(
		(startToken: string, endToken: string, collapseToStart = false) => {
			updateValueAtSelection(({ before, selected, after }) => {
				if (!selected) {
					const insertion = `${startToken}${endToken}`;
					return {
						value: `${before}${insertion}${after}`,
						selection: { start: before.length + startToken.length, end: before.length + startToken.length },
					};
				}

				const nextValue = `${before}${startToken}${selected}${endToken}${after}`;
				return {
					value: nextValue,
					selection: collapseToStart
						? { start: before.length + startToken.length, end: before.length + startToken.length }
						: { start: before.length + startToken.length + selected.length, end: before.length + startToken.length + selected.length },
				};
			});
		},
		[updateValueAtSelection],
	);

	const applyMiniMessageDecoration = React.useCallback(
		(tag: string) => {
			if (format !== 'minimessage') return;
			wrapSelection(`<${tag}>`, `</${tag}>`, true);
		},
		[format, wrapSelection],
	);

	const applyMiniMessageShadow = React.useCallback(
		(hex: string) => {
			if (format !== 'minimessage') return;
			wrapSelection(`<shadow:${hex}>`, '<reset>', true);
		},
		[format, wrapSelection],
	);

	const handleTextareaChange = React.useCallback(
		(event: React.ChangeEvent<HTMLTextAreaElement>) => {
			commitValue(event.target.value);
		},
		[commitValue],
	);

	const onColorPickerChange = React.useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			if (format === 'legacy') {
				const match = MOTD_COLOR_OPTIONS.find((option) => option.hex.toLowerCase() === event.target.value.toLowerCase());
				if (match) {
					applyLegacyCode(match.legacyCode);
				}
				return;
			}

			applyMiniMessageColor(event.target.value);
		},
		[applyLegacyCode, applyMiniMessageColor, format],
	);

	const onShadowPickerChange = React.useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			if (format !== 'minimessage') return;
			applyMiniMessageShadow(event.target.value);
		},
		[applyMiniMessageShadow, format],
	);

	return (
		<div className={cn('space-y-4 max-w-3xl', className)}>
			<div className='space-y-1'>
				<p className='text-xl font-semibold'>{label}</p>
				<p className='text-sm text-muted-foreground'>{description}</p>
			</div>

			<MotdPreview value={value} format={format} />

			<div className='flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground'>
				<div className='flex flex-wrap items-center gap-2'>
					<span className='rounded-full border border-border bg-muted px-3 py-1 font-medium text-foreground'>
						{formatLabel}
					</span>
					<span className='rounded-full border border-border bg-muted px-3 py-1 font-medium text-foreground'>
						Line lengths: {visibleLengths.map((length) => `${length}/${MOTD_VISUAL_LINE_WIDTH}`).join(' / ')}
					</span>
				</div>
				{advancedMode && (
					<ButtonGroup>
						<Button type='button' variant={!sourceMode ? 'secondary' : 'outline'} size='xs' onClick={() => setSourceMode(false)}>
							<Type className='size-3.5' /> Builder
						</Button>
						<Button type='button' variant={sourceMode ? 'secondary' : 'outline'} size='xs' onClick={() => setSourceMode(true)}>
							<Sparkles className='size-3.5' /> Source
						</Button>
					</ButtonGroup>
				)}
			</div>

			{!sourceMode ? (
				<div className='space-y-4 rounded-xl border-2 p-4'>
					<div className='flex flex-wrap items-center gap-2'>
						<ButtonGroup>
							<Button type='button' variant='outline' size='xs' onClick={() => applyAlignment('left')} disabled={isLocked}>
								<ChevronLeft className='size-3.5' /> Left
							</Button>
							<Button type='button' variant='outline' size='xs' onClick={() => applyAlignment('center')} disabled={isLocked}>
								Center
							</Button>
							<Button type='button' variant='outline' size='xs' onClick={() => applyAlignment('right')} disabled={isLocked}>
								Right <ChevronRight className='size-3.5' />
							</Button>
						</ButtonGroup>

						<ButtonGroupSeparator />

						<div className='flex flex-wrap items-center gap-1'>
							{MOTD_DECORATION_OPTIONS.map((option) => (
								<Button
									key={option.label}
									type='button'
									variant='outline'
									size='xs'
									title={option.label}
									onClick={() => (format === 'legacy' ? applyLegacyCode(option.legacyCode) : applyMiniMessageDecoration(option.miniMessageTag))}
									disabled={isLocked}>
									{option.label[0]}
								</Button>
							))}
						</div>
					</div>

					<div className='space-y-3'>
						<div className='flex flex-wrap items-center gap-2'>
							{format === 'minimessage' && (
								<div className='flex items-center gap-2 rounded-lg border-2 px-3 py-2'>
									<Palette className='size-4 text-muted-foreground' />
									<label className='flex items-center gap-2 text-sm font-medium'>
										<span>Color</span>
										<input
											type='color'
											className='size-8 rounded-md border-0 bg-transparent p-0'
											onChange={onColorPickerChange}
											disabled={isLocked}
										/>
									</label>
								</div>
							)}

							{format === 'minimessage' && (
								<div className='flex items-center gap-2 rounded-lg border-2 px-3 py-2'>
									<Paintbrush className='size-4 text-muted-foreground' />
									<label className='flex items-center gap-2 text-sm font-medium'>
										<span>Shadow</span>
										<input
											type='color'
											className='size-8 rounded-md border-0 bg-transparent p-0'
											onChange={onShadowPickerChange}
											disabled={isLocked}
										/>
									</label>
								</div>
							)}
						</div>

						<div className='grid grid-cols-4 gap-1 sm:grid-cols-8'>
							{MOTD_COLOR_OPTIONS.map((option) => (
								<Button
									key={option.label}
									type='button'
									variant='outline'
									size='icon-xs'
									title={option.label}
									aria-label={option.label}
									className='border-border p-0'
									style={{ backgroundColor: option.hex, color: '#000' }}
									onClick={() => (format === 'legacy' ? applyLegacyCode(option.legacyCode) : applyMiniMessageColor(option.miniMessageTag))}
									disabled={isLocked}>
									<span className='sr-only'>{option.label}</span>
								</Button>
							))}
						</div>
					</div>

					<Textarea
						ref={textareaRef}
						rows={2}
						className='min-h-24 font-mono text-sm leading-6'
						value={value}
						onChange={handleTextareaChange}
						disabled={isLocked}
						spellCheck={false}
					/>
				</div>
			) : (
				<div className='space-y-3 rounded-xl border-2 p-4'>
					<div className='flex items-center gap-2 text-sm text-muted-foreground'>
						<Sparkles className='size-4' />
						Raw source mode is available in advanced mode so you can edit the exact output string.
					</div>
					<Textarea
						ref={textareaRef}
						rows={2}
						className='min-h-24 font-mono text-sm leading-6'
						value={value}
						onChange={handleTextareaChange}
						disabled={isLocked}
						spellCheck={false}
					/>
				</div>
			)}
		</div>
	);
};

export default MotdEditor;
