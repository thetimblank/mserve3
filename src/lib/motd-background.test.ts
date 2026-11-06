import { describe, expect, it } from 'vitest';

import { buildMotdBackgroundGrid, buildMotdBackgroundSvg, MOTD_BACKGROUND_STYLE } from './motd-background';

describe('MOTD background tile', () => {
	it('is deterministic, so it never flickers between renders', () => {
		expect(buildMotdBackgroundSvg()).toBe(buildMotdBackgroundSvg());
		expect(buildMotdBackgroundSvg(1)).not.toBe(buildMotdBackgroundSvg(2));
	});

	it('fills a 16×16 grid with a handful of colors', () => {
		const grid = buildMotdBackgroundGrid();
		expect(grid).toHaveLength(16);
		expect(grid.every((row) => row.length === 16)).toBe(true);
		const colors = new Set(grid.flat());
		expect(colors.size).toBeGreaterThan(2);
		expect(colors.size).toBeLessThanOrEqual(6);
	});

	it('covers every pixel exactly once in the SVG', () => {
		const widths = [...buildMotdBackgroundSvg().matchAll(/width="(\d+)" height="1"/g)].map((match) =>
			Number(match[1]),
		);
		expect(widths.reduce((sum, width) => sum + width, 0)).toBe(16 * 16);
	});

	it('inlines the tile as a data URL', () => {
		expect(MOTD_BACKGROUND_STYLE.backgroundImage.startsWith('url("data:image/svg+xml,')).toBe(true);
	});
});
