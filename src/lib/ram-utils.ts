/** Smallest amount of RAM (in GB) a server may be configured with: 256 MB. */
export const RAM_MIN_GB = 0.25;

/** Clamps a RAM value (in GB) to the supported minimum, falling back to a
 *  default when the input is missing or not a positive number. */
export const clampRamGb = (value: number | null | undefined, fallback = 4): number => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return Math.max(RAM_MIN_GB, fallback);
	}
	return Math.max(RAM_MIN_GB, parsed);
};

/** Human-friendly RAM label, e.g. `0.5` → `512 MB`, `4` → `4 GB`. */
export const formatRamLabel = (gb: number): string => {
	const megabytes = Math.round(Math.max(0, gb) * 1024);
	return megabytes % 1024 === 0 ? `${megabytes / 1024} GB` : `${megabytes} MB`;
};

/** Skew exponent (< 1) applied on top of the logarithmic mapping used by the
 *  advanced RAM slider. Lower values give the low end (256/512 MB) more room and
 *  compress the high end harder so it drops off quickly past ~16 GB. */
const RAM_SLIDER_SKEW = 0.99;

/** Maps a RAM value (GB) to a 0..1 fraction along the advanced slider track.
 *  Uses a logarithmic scale (so each doubling gets even spacing) biased by
 *  {@link RAM_SLIDER_SKEW} to spread out low values and compress high ones. */
export const ramToSliderFraction = (gb: number, min: number, max: number): number => {
	if (max <= min) return 0;
	const clamped = Math.min(Math.max(gb, min), max);
	const logFraction = Math.log(clamped / min) / Math.log(max / min);
	return Math.pow(logFraction, RAM_SLIDER_SKEW);
};

/** Inverse of {@link ramToSliderFraction}: maps a 0..1 track fraction back to a
 *  RAM value (GB). */
export const sliderFractionToRam = (fraction: number, min: number, max: number): number => {
	if (max <= min) return min;
	const clamped = Math.min(Math.max(fraction, 0), 1);
	const logFraction = Math.pow(clamped, 1 / RAM_SLIDER_SKEW);
	return min * Math.pow(max / min, logFraction);
};

/** JVM heap-size token, matching the backend's `-Xmx`/`-Xms` formatting.
 *  Whole gigabytes use `G`; sub-gigabyte values use `M` (the JVM rejects
 *  fractional `G`), e.g. `0.5` → `512M`, `4` → `4G`. */
export const formatHeapSize = (gb: number): string => {
	const megabytes = Math.round(clampRamGb(gb) * 1024);
	return megabytes % 1024 === 0 ? `${megabytes / 1024}G` : `${megabytes}M`;
};

/** The fixed heap of a manual-RAM server, or `null` for auto (its cap is decided at each start). */
export const resolveManualRamGb = (server: { ram: number; ram_mode?: string }): number | null =>
	server.ram_mode === 'auto' ? null : server.ram;

/** Short label for a server's memory setting: `Auto`, or the fixed amount like `4GB`. */
export const formatRamSetting = (server: { ram: number; ram_mode?: string }): string =>
	server.ram_mode === 'auto' ? 'Auto' : `${server.ram}GB`;

/**
 * The heap a server can use right now: the live `-Xmx` while it runs (auto
 * servers pick theirs at each start), otherwise its fixed manual heap. `null`
 * for a stopped auto server, whose cap isn't decided yet.
 */
export const resolveHeapGb = (server: {
	ram: number;
	ram_mode?: string;
	stats?: { heap_max_gb?: number | null };
}): number | null => server.stats?.heap_max_gb ?? resolveManualRamGb(server);

/** Memory Windows keeps for itself when a manual heap is picked. */
const WINDOWS_RESERVED_GB = 2;

/**
 * Top of the manual RAM slider. On Windows it stops {@link WINDOWS_RESERVED_GB}
 * short of the system's memory (32 GB → 30, 8 GB → 6); elsewhere it reaches the
 * system total, but never below 10 so the scale reads well. 16 until the real
 * amount is known (the slider doesn't clamp against that placeholder).
 */
export const resolveRamSliderMaxGb = (systemMemoryGb: number | null, windows: boolean): number => {
	if (systemMemoryGb === null) return 16;
	if (windows) return Math.max(1, systemMemoryGb - WINDOWS_RESERVED_GB);
	return Math.max(10, systemMemoryGb);
};
