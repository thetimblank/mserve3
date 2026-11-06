/**
 * Recommended backup storage limit, sized from the drive that holds the
 * server folder (backups live in `<server>/.backups`). Pure helpers: the
 * disk numbers come from the `get_disk_space` command.
 */

export const BYTES_PER_GB = 1024 ** 3;
/** Lowest recommendation, also the fallback when the drive is nearly full. */
export const STORAGE_RECOMMENDATION_MIN_GB = 5;
/** Highest recommendation, however big the drive is. */
export const STORAGE_RECOMMENDATION_MAX_GB = 200;
/** Share of the free budget a single server's backups get by default. */
const BUDGET_SHARE = 0.3;
/** Always leave this much of the drive free: max(10% of the drive, 20 GB). */
const SAFETY_SHARE = 0.1;
const SAFETY_MIN_BYTES = 20 * BYTES_PER_GB;

/** Result of the `get_disk_space` command. */
export type DiskSpace = {
	totalBytes: number;
	availableBytes: number;
	mountPoint: string;
};

/** Another server's backups that may still grow on a drive. */
export type OtherServerBackups = {
	mountPoint: string;
	storageLimitGb: number;
	backupsBytes: number;
};

export type StorageRecommendation = {
	/** The suggested storage limit, in whole GB. */
	recommendedGb: number;
	/** The largest limit the slider offers, in whole GB. */
	sliderMaxGb: number;
	/** What other servers on the same drive may still fill. */
	reservedBytes: number;
	/** Space always left free on the drive. */
	safetyBytes: number;
	/** Free space left for this server's backups after reserved and safety. */
	budgetBytes: number;
	/** The budget is under the minimum recommendation: the drive is nearly full. */
	isLowDisk: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const roundTo5 = (value: number) => Math.round(value / 5) * 5;

const looksLikeWindowsPath = (value: string) => /^[a-z]:/i.test(value) || value.includes('\\');

/** Mount points match ignoring a trailing separator, and case on Windows drives. */
export const isSameMountPoint = (left: string, right: string) => {
	const normalize = (value: string) => {
		const trimmed = value.trim();
		const stripped = trimmed.length > 1 ? trimmed.replace(/[\\/]+$/, '') : trimmed;
		return looksLikeWindowsPath(trimmed) ? stripped.toLowerCase() : stripped;
	};
	return normalize(left) === normalize(right);
};

/** A short drive name for UI copy: `C:` on Windows, the mount path elsewhere. */
export const formatDriveLabel = (mountPoint: string) => {
	const trimmed = mountPoint.trim();
	if (/^[a-z]:[\\/]?$/i.test(trimmed)) return trimmed.slice(0, 2).toUpperCase();
	return trimmed || 'this drive';
};

/** Whole GB, rounded down, never negative. */
export const bytesToWholeGb = (bytes: number) => Math.max(0, Math.floor(bytes / BYTES_PER_GB));

/**
 * The recommended storage limit for a server's backups:
 * - `reserved` = sum over other servers on the drive of max(0, limit − current backups)
 * - `safety` = max(10% of the drive, 20 GB)
 * - `budget` = available − reserved − safety
 * - recommendation = clamp(roundTo5(budget × 0.3), 5, 200) GB, or 5 with a
 *   low-disk warning when the budget is under 5 GB.
 *
 * `ownBackupsBytes` is what this server's backups already use: those bytes are
 * on the drive already (not in `available`) but count toward its own limit.
 */
export const computeStorageRecommendation = ({
	disk,
	otherServers,
	ownBackupsBytes = 0,
}: {
	disk: DiskSpace;
	otherServers: OtherServerBackups[];
	ownBackupsBytes?: number;
}): StorageRecommendation => {
	const available = Math.max(0, disk.availableBytes) + Math.max(0, ownBackupsBytes);
	const reservedBytes = otherServers
		.filter((server) => isSameMountPoint(server.mountPoint, disk.mountPoint))
		.reduce(
			(total, server) =>
				total + Math.max(0, server.storageLimitGb * BYTES_PER_GB - Math.max(0, server.backupsBytes)),
			0,
		);
	const safetyBytes = Math.max(Math.max(0, disk.totalBytes) * SAFETY_SHARE, SAFETY_MIN_BYTES);
	const budgetBytes = available - reservedBytes - safetyBytes;
	const isLowDisk = budgetBytes < STORAGE_RECOMMENDATION_MIN_GB * BYTES_PER_GB;

	const recommendedGb = isLowDisk
		? STORAGE_RECOMMENDATION_MIN_GB
		: clamp(
				roundTo5((budgetBytes * BUDGET_SHARE) / BYTES_PER_GB),
				STORAGE_RECOMMENDATION_MIN_GB,
				STORAGE_RECOMMENDATION_MAX_GB,
			);
	const sliderMaxGb = Math.max(STORAGE_RECOMMENDATION_MIN_GB, bytesToWholeGb(available - safetyBytes));

	return { recommendedGb, sliderMaxGb, reservedBytes, safetyBytes, budgetBytes, isLowDisk };
};
