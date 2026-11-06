/**
 * The backdrop behind the MOTD editor: a dark, earthy pixel-noise tile that
 * evokes the multiplayer server list. It is original art generated here from a
 * fixed seed and our own palette, not a copy of any game texture.
 */

const TILE_SIZE = 16;
/** Rendered at 2× so each noise pixel reads as a chunky block. */
export const MOTD_BACKGROUND_TILE_PX = TILE_SIZE * 2;

// Dark browns, kept dim so every MOTD color (including gray and dark blue) stays readable.
const PALETTE = ['#1f1711', '#261c15', '#2d2219', '#34281d', '#3d2f23', '#4a392b'] as const;
const WEIGHTS = [2, 5, 6, 4, 2, 1] as const;
const TOTAL_WEIGHT = WEIGHTS.reduce((sum, weight) => sum + weight, 0);

/** Small deterministic PRNG (mulberry32), so the tile is identical on every render. */
const createRandom = (seed: number) => {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

/** The tile as a grid of palette colors, `grid[y][x]`. */
export const buildMotdBackgroundGrid = (seed = 0x6d73): string[][] => {
	const random = createRandom(seed);
	const pickColor = () => {
		let roll = random() * TOTAL_WEIGHT;
		for (let index = 0; index < PALETTE.length; index += 1) {
			roll -= WEIGHTS[index];
			if (roll < 0) return PALETTE[index];
		}
		return PALETTE[PALETTE.length - 1];
	};

	const grid: string[][] = [];
	for (let y = 0; y < TILE_SIZE; y += 1) {
		const row: string[] = [];
		for (let x = 0; x < TILE_SIZE; x += 1) {
			// Copying a neighbour now and then grows small clumps, which reads as
			// soil rather than TV static.
			const roll = random();
			if (x > 0 && roll < 0.3) row.push(row[x - 1]);
			else if (y > 0 && roll < 0.5) row.push(grid[y - 1][x]);
			else row.push(pickColor());
		}
		grid.push(row);
	}
	return grid;
};

/** An SVG of the tile, with horizontal runs of one color merged into one rect. */
export const buildMotdBackgroundSvg = (seed?: number) => {
	const rects: string[] = [];
	buildMotdBackgroundGrid(seed).forEach((row, y) => {
		let start = 0;
		for (let x = 1; x <= row.length; x += 1) {
			if (x < row.length && row[x] === row[start]) continue;
			rects.push(`<rect x="${start}" y="${y}" width="${x - start}" height="1" fill="${row[start]}"/>`);
			start = x;
		}
	});
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
};

/** Inline style for the editor surface. The CSP already allows `data:` images. */
export const MOTD_BACKGROUND_STYLE = {
	backgroundColor: PALETTE[2],
	backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(buildMotdBackgroundSvg())}")`,
	backgroundSize: `${MOTD_BACKGROUND_TILE_PX}px ${MOTD_BACKGROUND_TILE_PX}px`,
	imageRendering: 'pixelated',
} as const;
