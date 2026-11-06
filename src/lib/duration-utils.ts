/** Durations are stored as whole minutes everywhere in the UI. */
import { pluralize as plural } from '@/lib/utils';

export const DEFAULT_DURATION_PRESETS: readonly number[] = [15, 30, 60, 180, 360, 720, 1440];

/** Hours column of the wheel picker goes up to this unless `max` is lower. */
export const WHEEL_MAX_HOURS = 48;
export const WHEEL_MINUTE_STEP = 5;

export const clampDuration = (minutes: number, min: number, max: number) =>
	Math.min(Math.max(Math.round(minutes), min), max);

/** Compact label for chips: `15m`, `1h`, `1h 30m`. */
export const formatDurationShort = (minutes: number) => {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours === 0) return `${rest}m`;
	if (rest === 0) return `${hours}h`;
	return `${hours}h ${rest}m`;
};

/** Spelled-out label for screen readers and summaries: `1 hour 30 minutes`. */
export const formatDurationLong = (minutes: number) => {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours === 0) return plural(rest, 'minute');
	if (rest === 0) return plural(hours, 'hour');
	return `${plural(hours, 'hour')} ${plural(rest, 'minute')}`;
};

/**
 * Items of the wheel's hours column: 0 up to `WHEEL_MAX_HOURS` (or what `max`
 * allows), extended so a stored value outside min/max still shows.
 */
export const buildWheelHours = (value: number, min: number, max: number) => {
	const first = Math.min(Math.floor(min / 60), Math.floor(value / 60));
	const last = Math.max(Math.min(WHEEL_MAX_HOURS, Math.floor(max / 60)), Math.floor(value / 60), first);
	return Array.from({ length: last - first + 1 }, (_, index) => first + index);
};

/**
 * Items of the wheel's minutes column: 0–55 in 5-minute steps, plus the
 * stored minute when it is off-step (so a value of 7 isn't silently snapped).
 */
export const buildWheelMinutes = (value: number) => {
	const minutes = Array.from({ length: 60 / WHEEL_MINUTE_STEP }, (_, index) => index * WHEEL_MINUTE_STEP);
	const current = value % 60;
	if (!minutes.includes(current)) minutes.push(current);
	return minutes.sort((a, b) => a - b);
};

export type DurationUnit = 'minutes' | 'hours';

export const DURATION_UNIT_MINUTES: Record<DurationUnit, number> = { minutes: 1, hours: 60 };

/** Whole hours read better as hours (`2 hours`), anything else as minutes. */
export const resolveDurationUnit = (minutes: number): DurationUnit =>
	minutes >= 60 && minutes % 60 === 0 ? 'hours' : 'minutes';

/**
 * Parse the number-unit input. Hours accept decimals (`1.5` → 90 minutes);
 * returns `null` for empty or invalid input.
 */
export const parseDurationAmount = (text: string, unit: DurationUnit): number | null => {
	const trimmed = text.trim();
	if (!trimmed) return null;
	const amount = Number(trimmed);
	if (!Number.isFinite(amount) || amount < 0) return null;
	return Math.round(amount * DURATION_UNIT_MINUTES[unit]);
};

/** The amount shown in the number-unit input for a value in a unit. */
export const formatDurationAmount = (minutes: number, unit: DurationUnit) => {
	const amount = minutes / DURATION_UNIT_MINUTES[unit];
	return String(Number.isInteger(amount) ? amount : Number(amount.toFixed(2)));
};

/**
 * Clamp a value picked on the wheel. When the clamp would land off the
 * 5-minute grid (a `min` of 1 with the wheel at 0h 0m), prefer the nearest
 * in-range step so the minutes column doesn't grow a one-off item.
 */
export const clampWheelDuration = (minutes: number, min: number, max: number) => {
	const clamped = clampDuration(minutes, min, max);
	if (clamped === minutes || clamped % WHEEL_MINUTE_STEP === 0) return clamped;
	const stepped =
		minutes < min
			? Math.ceil(min / WHEEL_MINUTE_STEP) * WHEEL_MINUTE_STEP
			: Math.floor(max / WHEEL_MINUTE_STEP) * WHEEL_MINUTE_STEP;
	return stepped >= min && stepped <= max ? stepped : clamped;
};
