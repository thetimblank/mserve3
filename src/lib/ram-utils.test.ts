import { describe, expect, it } from 'vitest';
import {
	RAM_MIN_GB,
	clampRamGb,
	formatRamLabel,
	ramToSliderFraction,
	sliderFractionToRam,
	formatHeapSize,
} from './ram-utils';

describe('clampRamGb', () => {
	it('keeps valid values', () => {
		expect(clampRamGb(4)).toBe(4);
	});
	it('enforces the minimum', () => {
		expect(clampRamGb(0.01)).toBe(RAM_MIN_GB);
	});
	it('falls back when missing or non-positive', () => {
		expect(clampRamGb(null)).toBe(4);
		expect(clampRamGb(undefined, 8)).toBe(8);
		expect(clampRamGb(-2, 6)).toBe(6);
	});
});

describe('formatRamLabel', () => {
	it('uses GB for whole gigabytes', () => {
		expect(formatRamLabel(4)).toBe('4 GB');
	});
	it('uses MB for sub-gigabyte values', () => {
		expect(formatRamLabel(0.5)).toBe('512 MB');
	});
});

describe('formatHeapSize (matches backend -Xmx tokens)', () => {
	it('uses G for whole gigabytes', () => {
		expect(formatHeapSize(4)).toBe('4G');
	});
	it('uses M for fractional gigabytes (the JVM rejects fractional G)', () => {
		expect(formatHeapSize(0.5)).toBe('512M');
	});
});

describe('slider mapping round-trips', () => {
	const min = RAM_MIN_GB;
	const max = 32;

	it('fraction -> ram -> fraction is stable', () => {
		for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
			const gb = sliderFractionToRam(fraction, min, max);
			const back = ramToSliderFraction(gb, min, max);
			expect(back).toBeCloseTo(fraction, 5);
		}
	});

	it('ram -> fraction -> ram is stable', () => {
		for (const gb of [0.25, 0.5, 1, 2, 4, 8, 16, 32]) {
			const fraction = ramToSliderFraction(gb, min, max);
			const back = sliderFractionToRam(fraction, min, max);
			expect(back).toBeCloseTo(gb, 5);
		}
	});

	it('clamps out-of-range inputs', () => {
		expect(ramToSliderFraction(64, min, max)).toBeCloseTo(1, 5);
		expect(ramToSliderFraction(0.01, min, max)).toBeCloseTo(0, 5);
		expect(sliderFractionToRam(2, min, max)).toBeCloseTo(max, 5);
		expect(sliderFractionToRam(-1, min, max)).toBeCloseTo(min, 5);
	});

	it('degenerate range is handled', () => {
		expect(ramToSliderFraction(4, 8, 8)).toBe(0);
		expect(sliderFractionToRam(0.5, 8, 8)).toBe(8);
	});
});
