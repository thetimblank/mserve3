/**
 * The bento layout's shape vocabulary. Cards declare a fixed {@link BentoSize};
 * the grid places them left→right, top→bottom on a 2-col (narrow) / 4-col (wide)
 * track so the sizes below tile without gaps:
 *
 *   [ full ───────────────────────── ]
 *   [ lg      ][ lg      ]
 *   [ wide    ][ wide    ]
 *
 * Sizes deliberately avoid odd column spans so we never need `grid-auto-flow:
 * dense` (which would desync visual order from DOM order and break the sortable).
 */

export type BentoSize = 'sm' | 'wide' | 'tall' | 'lg' | 'full';

/** Container grid classes for the draggable bento zone. */
export const BENTO_GRID_CLASSES =
	'grid grid-cols-2 xl:grid-cols-4 gap-4 auto-rows-[minmax(11rem,auto)]';

/** Container grid classes for the fixed top metrics/anchor zone. */
export const BENTO_METRICS_GRID_CLASSES = 'grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4';

/** Span classes for each shape. `full` and `wide` collapse to full width on the
 *  narrow 2-col grid so a card never leaves a dangling empty cell beside it. */
export const bentoSizeClasses = (size: BentoSize): string => {
	switch (size) {
		case 'sm':
			return 'col-span-1 row-span-1';
		case 'wide':
			return 'col-span-2 row-span-1';
		case 'tall':
			return 'col-span-1 row-span-2';
		case 'lg':
			return 'col-span-2 row-span-2';
		case 'full':
			return 'col-span-2 xl:col-span-4';
	}
};
