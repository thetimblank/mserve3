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
const RAM_SLIDER_SKEW = 0.75;

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
