import * as React from 'react';
import { useReducedMotion } from 'motion/react';

import { Input } from '@/components/ui/input';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useReducedMotionSetting } from '@/data/user';
import {
	DEFAULT_DURATION_PRESETS,
	DURATION_UNIT_MINUTES,
	buildWheelHours,
	buildWheelMinutes,
	clampDuration,
	clampWheelDuration,
	formatDurationAmount,
	formatDurationLong,
	formatDurationShort,
	parseDurationAmount,
	resolveDurationUnit,
	type DurationUnit,
} from '@/lib/duration-utils';
import { cn } from '@/lib/utils';

export type DurationPickerCustomInput = 'wheel' | 'number-unit';

type DurationPickerProps = {
	/** The duration in whole minutes. */
	value: number;
	onValueChange: (minutes: number) => void;
	/** Preset chips, in minutes. Presets outside `min`/`max` are hidden. */
	presets?: readonly number[];
	/**
	 * The "Custom" input. The wheel is an experiment; `number-unit`
	 * ("[30] [minutes ▾]") is the plain fallback.
	 */
	custom?: DurationPickerCustomInput;
	/** Smallest allowed value in minutes. Defaults to 1. */
	min?: number;
	/** Largest allowed value in minutes. Defaults to no limit (the wheel stops at 48h). */
	max?: number;
	disabled?: boolean;
	className?: string;
	'aria-label'?: string;
	'aria-labelledby'?: string;
};

const CUSTOM_OPTION = 'custom';

/**
 * Pick a duration: preset chips first, then "Custom" for anything else. The
 * value is always whole minutes and always within `min`/`max`.
 */
function DurationPicker({
	value,
	onValueChange,
	presets = DEFAULT_DURATION_PRESETS,
	custom = 'wheel',
	min = 1,
	max = Number.POSITIVE_INFINITY,
	disabled,
	className,
	'aria-label': ariaLabel,
	'aria-labelledby': ariaLabelledBy,
}: DurationPickerProps) {
	const visiblePresets = React.useMemo(
		() => presets.filter((preset) => preset >= min && preset <= max),
		[presets, min, max],
	);
	const isPresetValue = visiblePresets.includes(value);
	// Picking "Custom" keeps the custom input open even when it lands on a
	// preset value; a value that isn't a preset always shows it.
	const [isCustomPicked, setIsCustomPicked] = React.useState(!isPresetValue);
	const showCustom = isCustomPicked || !isPresetValue;

	// A value that changes from outside (loaded config, a reset) re-decides
	// between chip and Custom; one the custom input just emitted does not.
	const customEmittedRef = React.useRef<number | null>(null);
	const [syncedValue, setSyncedValue] = React.useState(value);
	if (value !== syncedValue) {
		setSyncedValue(value);
		if (value !== customEmittedRef.current) setIsCustomPicked(!isPresetValue);
	}

	const handleCustomChange = (next: number) => {
		customEmittedRef.current = next;
		onValueChange(next);
	};

	const options = React.useMemo<SegmentedControlOption<string>[]>(
		() => [
			...visiblePresets.map((preset) => ({
				value: String(preset),
				label: formatDurationShort(preset),
				ariaLabel: formatDurationLong(preset),
			})),
			{ value: CUSTOM_OPTION, label: 'Custom' },
		],
		[visiblePresets],
	);

	const handlePresetChange = (next: string) => {
		if (next === CUSTOM_OPTION) {
			setIsCustomPicked(true);
			return;
		}
		setIsCustomPicked(false);
		customEmittedRef.current = null;
		onValueChange(Number(next));
	};

	return (
		<div
			role='group'
			aria-label={ariaLabel}
			aria-labelledby={ariaLabelledBy}
			data-slot='duration-picker'
			className={cn('flex flex-col gap-3', className)}>
			<SegmentedControl
				size='sm'
				aria-label='Presets'
				className='h-auto flex-wrap'
				value={showCustom ? CUSTOM_OPTION : String(value)}
				onValueChange={handlePresetChange}
				options={options}
				disabled={disabled}
			/>
			{showCustom &&
				(custom === 'wheel' ? (
					<DurationWheel
						value={value}
						onValueChange={handleCustomChange}
						min={min}
						max={max}
						disabled={disabled}
					/>
				) : (
					<DurationNumberUnit
						value={value}
						onValueChange={handleCustomChange}
						min={min}
						max={max}
						disabled={disabled}
					/>
				))}
		</div>
	);
}

type CustomInputProps = {
	value: number;
	onValueChange: (minutes: number) => void;
	min: number;
	max: number;
	disabled?: boolean;
};

function DurationWheel({ value, onValueChange, min, max, disabled }: CustomInputProps) {
	const hours = Math.floor(value / 60);
	const minutes = value % 60;
	const hourItems = React.useMemo(() => buildWheelHours(value, min, max), [value, min, max]);
	const minuteItems = React.useMemo(() => buildWheelMinutes(value), [value]);

	const commit = (nextHours: number, nextMinutes: number) => {
		const next = clampWheelDuration(nextHours * 60 + nextMinutes, min, max);
		if (next !== value) onValueChange(next);
	};

	return (
		<div className='flex w-fit items-start gap-2' data-slot='duration-wheel'>
			<WheelColumn
				label='Hours'
				unitLabel='h'
				items={hourItems}
				selected={hours}
				valueText={(item) => `${item} ${item === 1 ? 'hour' : 'hours'}`}
				onSelect={(item) => commit(item, minutes)}
				disabled={disabled}
			/>
			<WheelColumn
				label='Minutes'
				unitLabel='m'
				items={minuteItems}
				selected={minutes}
				valueText={(item) => `${item} ${item === 1 ? 'minute' : 'minutes'}`}
				onSelect={(item) => commit(hours, item)}
				disabled={disabled}
			/>
		</div>
	);
}

const WHEEL_ITEM_HEIGHT = 32;
/** Rows above and below the selected one. */
const WHEEL_SIDE_ROWS = 2;
/** Scroll distance (px) one wheel step needs, so a trackpad doesn't spin wildly. */
const WHEEL_STEP_THRESHOLD = 40;
/** How long scrolling must pause before the snapped item counts as picked. */
const WHEEL_SETTLE_MS = 120;

type WheelColumnProps = {
	label: string;
	unitLabel: string;
	items: readonly number[];
	selected: number;
	valueText: (item: number) => string;
	onSelect: (item: number) => void;
	disabled?: boolean;
};

const scrollColumnTo = (element: HTMLElement, top: number, behavior: ScrollBehavior) => {
	if (typeof element.scrollTo === 'function') element.scrollTo({ top, behavior });
	else element.scrollTop = top;
};

/**
 * One scroll-snap column, exposed as a spinbutton: arrow keys, Page Up/Down,
 * Home/End and each mouse wheel notch step one item; dragging or a trackpad
 * scrolls freely and the item that snaps to the middle is picked.
 */
function WheelColumn({ label, unitLabel, items, selected, valueText, onSelect, disabled }: WheelColumnProps) {
	const scrollRef = React.useRef<HTMLDivElement>(null);
	const prefersReducedMotion = useReducedMotion();
	const reducedMotionSetting = useReducedMotionSetting();
	const scrollBehavior: ScrollBehavior = prefersReducedMotion || reducedMotionSetting ? 'auto' : 'smooth';
	const selectedIndex = Math.max(0, items.indexOf(selected));
	// Bumped after a scroll settles, so the column snaps back even when the pick
	// was clamped to the value it already had.
	const [settleCount, setSettleCount] = React.useState(0);
	const hasSyncedRef = React.useRef(false);

	// Listeners registered once read the latest props from here.
	const latestRef = React.useRef({ items, selectedIndex, onSelect, disabled });
	React.useLayoutEffect(() => {
		latestRef.current = { items, selectedIndex, onSelect, disabled };
	});

	const stepBy = React.useCallback((delta: number) => {
		const { items: list, selectedIndex: index, onSelect: select, disabled: isDisabled } = latestRef.current;
		if (isDisabled) return;
		// Home/End pass ±Infinity and land on the first/last item.
		const next = Math.min(Math.max(index + delta, 0), list.length - 1);
		if (next !== index) select(list[next]);
	}, []);

	React.useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		const top = selectedIndex * WHEEL_ITEM_HEIGHT;
		// The first position is set instantly, later ones glide.
		const behavior = hasSyncedRef.current ? scrollBehavior : 'auto';
		hasSyncedRef.current = true;
		if (Math.abs(element.scrollTop - top) >= 1) scrollColumnTo(element, top, behavior);
	}, [selectedIndex, settleCount, scrollBehavior]);

	// Native, non-passive wheel listener: React's onWheel is passive and can't
	// stop the column from free-scrolling past several items per notch.
	React.useEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		let accumulated = 0;
		const handleWheel = (event: WheelEvent) => {
			const { items: list, selectedIndex: index, disabled: isDisabled } = latestRef.current;
			const direction = Math.sign(event.deltaY);
			const atEnd = (direction < 0 && index === 0) || (direction > 0 && index === list.length - 1);
			// Let the page scroll on when the column can't move further that way.
			if (isDisabled || direction === 0 || atEnd) {
				accumulated = 0;
				return;
			}
			event.preventDefault();
			const scale =
				event.deltaMode === WheelEvent.DOM_DELTA_LINE
					? 16
					: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
						? WHEEL_ITEM_HEIGHT * (WHEEL_SIDE_ROWS * 2 + 1)
						: 1;
			accumulated += event.deltaY * scale;
			if (Math.abs(accumulated) < WHEEL_STEP_THRESHOLD) return;
			stepBy(Math.sign(accumulated));
			accumulated = 0;
		};
		element.addEventListener('wheel', handleWheel, { passive: false });
		return () => element.removeEventListener('wheel', handleWheel);
	}, [stepBy]);

	const settleTimerRef = React.useRef<number | undefined>(undefined);
	React.useEffect(() => () => window.clearTimeout(settleTimerRef.current), []);

	const handleScroll = () => {
		window.clearTimeout(settleTimerRef.current);
		settleTimerRef.current = window.setTimeout(() => {
			const element = scrollRef.current;
			if (!element) return;
			const { items: list, selectedIndex: index, onSelect: select, disabled: isDisabled } = latestRef.current;
			const snapped = Math.min(Math.max(Math.round(element.scrollTop / WHEEL_ITEM_HEIGHT), 0), list.length - 1);
			if (isDisabled || snapped === index) return;
			select(list[snapped]);
			setSettleCount((count) => count + 1);
		}, WHEEL_SETTLE_MS);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const deltas: Record<string, number> = {
			ArrowUp: 1,
			ArrowDown: -1,
			PageUp: 5,
			PageDown: -5,
			Home: -Infinity,
			End: Infinity,
		};
		const delta = deltas[event.key];
		if (delta === undefined) return;
		event.preventDefault();
		stepBy(delta);
	};

	const columnHeight = WHEEL_ITEM_HEIGHT * (WHEEL_SIDE_ROWS * 2 + 1);
	const sidePadding = WHEEL_ITEM_HEIGHT * WHEEL_SIDE_ROWS;

	return (
		<div className='flex flex-col items-center gap-1'>
			<span aria-hidden className='text-xs text-muted-foreground'>
				{label}
			</span>
			<div className='relative'>
				<div
					aria-hidden
					className='pointer-events-none absolute inset-x-0 rounded-md bg-secondary'
					style={{ top: sidePadding, height: WHEEL_ITEM_HEIGHT }}
				/>
				<div
					ref={scrollRef}
					role='spinbutton'
					tabIndex={disabled ? -1 : 0}
					aria-label={label}
					aria-valuenow={selected}
					aria-valuetext={valueText(selected)}
					aria-valuemin={items[0]}
					aria-valuemax={items[items.length - 1]}
					aria-disabled={disabled || undefined}
					data-slot='duration-wheel-column'
					onScroll={handleScroll}
					onKeyDown={handleKeyDown}
					className={cn(
						'relative w-16 snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-md outline-none',
						'[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
						'[mask-image:linear-gradient(to_bottom,transparent,black_35%,black_65%,transparent)]',
						'focus-visible:ring-[3px] focus-visible:ring-ring/50',
						disabled && 'pointer-events-none opacity-50',
					)}
					style={{ height: columnHeight, paddingBlock: sidePadding }}>
					{items.map((item) => {
						const isSelected = item === selected;
						return (
							<div
								key={item}
								aria-hidden
								onClick={() => !disabled && onSelect(item)}
								className={cn(
									'flex snap-center cursor-pointer items-center justify-center gap-0.5 tabular-nums transition-colors select-none',
									isSelected ? 'font-semibold text-foreground' : 'text-muted-foreground',
								)}
								style={{ height: WHEEL_ITEM_HEIGHT }}>
								{item}
								<span className='text-xs text-muted-foreground'>{unitLabel}</span>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function DurationNumberUnit({ value, onValueChange, min, max, disabled }: CustomInputProps) {
	const [unit, setUnit] = React.useState<DurationUnit>(() => resolveDurationUnit(value));
	const [text, setText] = React.useState(() => formatDurationAmount(value, unit));

	// Follow outside changes (a preset, a reset) without clobbering what the
	// user is typing when it already means the same value.
	const [syncedValue, setSyncedValue] = React.useState(value);
	if (value !== syncedValue) {
		setSyncedValue(value);
		if (parseDurationAmount(text, unit) !== value) setText(formatDurationAmount(value, unit));
	}

	const handleTextChange = (nextText: string) => {
		setText(nextText);
		const parsed = parseDurationAmount(nextText, unit);
		// Out-of-range input is fixed up on blur, not while typing ("1" on the
		// way to "15" with a min of 5).
		if (parsed !== null && parsed >= min && parsed <= max && parsed !== value) onValueChange(parsed);
	};

	const handleBlur = () => {
		const next = clampDuration(parseDurationAmount(text, unit) ?? value, min, max);
		setText(formatDurationAmount(next, unit));
		if (next !== value) onValueChange(next);
	};

	const handleUnitChange = (nextUnit: DurationUnit) => {
		// "Every [30] [minutes]" → "Every [30] [hours]": a whole number stays and
		// changes meaning. A fraction ("1.5" hours) converts instead, since
		// rounding it in minutes would lose the value.
		const amount = Number(text.trim());
		const keepsNumber = text.trim() !== '' && Number.isInteger(amount);
		const next = clampDuration(
			keepsNumber ? (parseDurationAmount(text, nextUnit) ?? value) : value,
			min,
			max,
		);
		setUnit(nextUnit);
		setText(formatDurationAmount(next, nextUnit));
		if (next !== value) onValueChange(next);
	};

	const factor = DURATION_UNIT_MINUTES[unit];
	const amount = Number(text);
	const isSingular = amount === 1;

	return (
		<div className='flex items-center gap-2' data-slot='duration-number-unit'>
			<Input
				type='number'
				inputMode='decimal'
				aria-label={`Duration in ${unit}`}
				className='w-24'
				// `min` is also the step base: keep it at 0 in hours so 0.5 steps
				// land on clean half hours. The real minimum is applied on blur.
				min={unit === 'hours' ? 0 : min}
				max={Number.isFinite(max) ? max / factor : undefined}
				step={unit === 'hours' ? 0.5 : 1}
				value={text}
				disabled={disabled}
				onChange={(event) => handleTextChange(event.target.value)}
				onBlur={handleBlur}
			/>
			<Select value={unit} onValueChange={(next) => handleUnitChange(next as DurationUnit)} disabled={disabled}>
				<SelectTrigger aria-label='Unit' className='w-32'>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value='minutes'>{isSingular ? 'minute' : 'minutes'}</SelectItem>
					<SelectItem value='hours'>{isSingular ? 'hour' : 'hours'}</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}

export { DurationPicker };
