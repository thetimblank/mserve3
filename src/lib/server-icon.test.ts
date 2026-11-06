import { describe, expect, it } from 'vitest';

import { computeCoverCrop, isServerIconSourcePath, planIconResizeSteps } from './server-icon';

describe('computeCoverCrop', () => {
	it('takes the centered square of a landscape image', () => {
		expect(computeCoverCrop(1920, 1080)).toEqual({ sx: 420, sy: 0, side: 1080 });
	});

	it('takes the centered square of a portrait image', () => {
		expect(computeCoverCrop(100, 300)).toEqual({ sx: 0, sy: 100, side: 100 });
	});

	it('keeps a square image whole', () => {
		expect(computeCoverCrop(64, 64)).toEqual({ sx: 0, sy: 0, side: 64 });
	});
});

describe('planIconResizeSteps', () => {
	it('draws small and exact images straight to 64', () => {
		expect(planIconResizeSteps(16)).toEqual([64]);
		expect(planIconResizeSteps(64)).toEqual([64]);
		expect(planIconResizeSteps(127)).toEqual([64]);
	});

	it('halves a large image step by step down to 64', () => {
		expect(planIconResizeSteps(128)).toEqual([128, 64]);
		expect(planIconResizeSteps(1000)).toEqual([512, 256, 128, 64]);
	});

	it('caps the first canvas at 1024 px for huge photos', () => {
		expect(planIconResizeSteps(6000)).toEqual([1024, 512, 256, 128, 64]);
	});
});

describe('isServerIconSourcePath', () => {
	it('accepts the supported image types in any case, on either path style', () => {
		expect(isServerIconSourcePath('C:\\Users\\me\\Pictures\\logo.PNG')).toBe(true);
		expect(isServerIconSourcePath('/home/me/photo.jpeg')).toBe(true);
		expect(isServerIconSourcePath('favicon.ico')).toBe(true);
	});

	it('rejects other files', () => {
		expect(isServerIconSourcePath('notes.txt')).toBe(false);
		expect(isServerIconSourcePath('/home/me/.png')).toBe(false);
		expect(isServerIconSourcePath('/home/me.dir/no-extension')).toBe(false);
	});
});
