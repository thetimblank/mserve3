import { describe, expect, it } from 'vitest';
import {
	buildWheelHours,
	buildWheelMinutes,
	clampWheelDuration,
	formatDurationAmount,
	formatDurationLong,
	formatDurationShort,
	parseDurationAmount,
	resolveDurationUnit,
} from './duration-utils';

const last = (items: number[]) => items[items.length - 1];

describe('duration formatting', () => {
	it('formats short chip labels', () => {
		expect(formatDurationShort(15)).toBe('15m');
		expect(formatDurationShort(60)).toBe('1h');
		expect(formatDurationShort(90)).toBe('1h 30m');
		expect(formatDurationShort(1440)).toBe('24h');
	});

	it('spells durations out with plurals', () => {
		expect(formatDurationLong(1)).toBe('1 minute');
		expect(formatDurationLong(45)).toBe('45 minutes');
		expect(formatDurationLong(60)).toBe('1 hour');
		expect(formatDurationLong(125)).toBe('2 hours 5 minutes');
	});
});

describe('wheel columns', () => {
	it('lists hours 0–48 by default and respects a lower max', () => {
		const hours = buildWheelHours(30, 1, Number.POSITIVE_INFINITY);
		expect(hours[0]).toBe(0);
		expect(last(hours)).toBe(48);
		expect(last(buildWheelHours(30, 1, 6 * 60))).toBe(6);
	});

	it('starts hours at the min and grows to fit a larger stored value', () => {
		expect(buildWheelHours(180, 120, 600)[0]).toBe(2);
		expect(last(buildWheelHours(72 * 60, 1, Number.POSITIVE_INFINITY))).toBe(72);
	});

	it('lists minutes in 5-minute steps plus an off-step stored minute', () => {
		expect(buildWheelMinutes(60)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
		expect(buildWheelMinutes(67)).toContain(7);
		expect(buildWheelMinutes(67).indexOf(7)).toBe(2);
	});

	it('clamps wheel picks onto the 5-minute grid when it can', () => {
		expect(clampWheelDuration(0, 1, 100)).toBe(5);
		expect(clampWheelDuration(0, 15, 100)).toBe(15);
		expect(clampWheelDuration(200, 1, 98)).toBe(95);
		expect(clampWheelDuration(0, 1, 3)).toBe(1);
		expect(clampWheelDuration(65, 1, 100)).toBe(65);
	});
});

describe('number-unit input', () => {
	it('picks hours for whole hours, minutes otherwise', () => {
		expect(resolveDurationUnit(120)).toBe('hours');
		expect(resolveDurationUnit(90)).toBe('minutes');
		expect(resolveDurationUnit(30)).toBe('minutes');
	});

	it('parses amounts in the chosen unit', () => {
		expect(parseDurationAmount('30', 'minutes')).toBe(30);
		expect(parseDurationAmount('1.5', 'hours')).toBe(90);
		expect(parseDurationAmount(' ', 'minutes')).toBeNull();
		expect(parseDurationAmount('abc', 'hours')).toBeNull();
		expect(parseDurationAmount('-5', 'minutes')).toBeNull();
	});

	it('formats amounts back for the input', () => {
		expect(formatDurationAmount(90, 'hours')).toBe('1.5');
		expect(formatDurationAmount(120, 'hours')).toBe('2');
		expect(formatDurationAmount(20, 'hours')).toBe('0.33');
		expect(formatDurationAmount(45, 'minutes')).toBe('45');
	});
});
