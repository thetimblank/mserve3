/**
 * The bento layout's shape vocabulary.
 *
 * Every grid here sizes on the dashboard's own content width through container
 * queries (the bento root is the `@container`), not the viewport: the app
 * sidebar takes 16rem, so viewport breakpoints like `xl:` fired far later than
 * the content actually had room, and the wide layout only showed when maximized.
 *
 * The bento is a vertical stack of **clusters** (Servers, Storage, Activity,
 * Attention, Networks). A cluster has no surface of its own: it is a grid of
 * cards, led by a title card. Clusters are the sortable/hideable unit.
 *
 * Storage and Activity share one shape, so they tile without gaps:
 *
 *   4 columns:  [ title ][ wide ──────── ][ stack ]
 *   2 columns:  [ title ][ stack ]
 *               [ wide ────────── ]
 *
 * The wide card moves after the stack on the 2-column grid through `order`, so
 * no `grid-auto-flow: dense` is needed.
 */

/** Grid for one cluster's cards: 2 columns, 4 once the content is 48rem wide. */
export const BENTO_CLUSTER_GRID_CLASSES =
	'grid grid-cols-2 gap-4 auto-rows-[minmax(9.5rem,auto)] @3xl:grid-cols-4';

/** The fixed top metrics/anchor row: 2, then 3, then all 6 tiles in one row. */
export const BENTO_METRICS_GRID_CLASSES = 'grid grid-cols-2 gap-4 @2xl:grid-cols-3 @7xl:grid-cols-6';

/** The wide visual of a title / wide / stack cluster (see the diagram above). */
export const BENTO_WIDE_ITEM_CLASSES = 'col-span-2 order-last @3xl:order-none';

/** One grid cell holding two compact cards stacked on top of each other. */
export const BENTO_STACK_CLASSES = 'grid grid-rows-2 gap-4';
