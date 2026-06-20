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

/** JVM heap-size token, matching the backend's `-Xmx`/`-Xms` formatting.
 *  Whole gigabytes use `G`; sub-gigabyte values use `M` (the JVM rejects
 *  fractional `G`), e.g. `0.5` → `512M`, `4` → `4G`. */
export const formatHeapSize = (gb: number): string => {
	const megabytes = Math.round(clampRamGb(gb) * 1024);
	return megabytes % 1024 === 0 ? `${megabytes / 1024}G` : `${megabytes}M`;
};
