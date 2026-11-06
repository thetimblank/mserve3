import { describe, expect, it } from 'vitest';
import {
	BYTES_PER_GB,
	computeStorageRecommendation,
	formatDriveLabel,
	isSameMountPoint,
	roundTo5,
	type DiskSpace,
} from './storage-recommendation';

const GB = BYTES_PER_GB;
const disk = (totalGb: number, availableGb: number, mountPoint = 'C:\\'): DiskSpace => ({
	totalBytes: totalGb * GB,
	availableBytes: availableGb * GB,
	mountPoint,
});

describe('roundTo5', () => {
	it('rounds to the nearest multiple of 5', () => {
		expect(roundTo5(12)).toBe(10);
		expect(roundTo5(13)).toBe(15);
		expect(roundTo5(57.4)).toBe(55);
	});
});

describe('computeStorageRecommendation', () => {
	it('takes 30% of the budget after the safety margin', () => {
		// 1 TB drive, 500 GB free: safety = max(100, 20) = 100, budget = 400, 30% = 120.
		const result = computeStorageRecommendation({ disk: disk(1000, 500), otherServers: [] });
		expect(result.safetyBytes).toBe(100 * GB);
		expect(result.budgetBytes).toBe(400 * GB);
		expect(result.recommendedGb).toBe(120);
		expect(result.isLowDisk).toBe(false);
		expect(result.sliderMaxGb).toBe(400);
	});

	it('uses a 20 GB safety margin on small drives', () => {
		// 100 GB drive, 80 free: safety = max(10, 20) = 20, budget = 60, 30% = 18 -> 20.
		const result = computeStorageRecommendation({ disk: disk(100, 80), otherServers: [] });
		expect(result.safetyBytes).toBe(20 * GB);
		expect(result.recommendedGb).toBe(20);
	});

	it('caps the recommendation at 200 GB', () => {
		const result = computeStorageRecommendation({ disk: disk(4000, 3000), otherServers: [] });
		expect(result.recommendedGb).toBe(200);
	});

	it('never recommends less than 5 GB', () => {
		// budget = 30 - 20 = 10 GB, 30% = 3 -> clamped up to 5, but not a low disk.
		const result = computeStorageRecommendation({ disk: disk(100, 30), otherServers: [] });
		expect(result.recommendedGb).toBe(5);
		expect(result.isLowDisk).toBe(false);
	});

	it('flags a low disk when the budget is under 5 GB', () => {
		const result = computeStorageRecommendation({ disk: disk(100, 22), otherServers: [] });
		expect(result.recommendedGb).toBe(5);
		expect(result.isLowDisk).toBe(true);
		expect(result.sliderMaxGb).toBe(5);
	});

	it('reserves what other servers on the same drive may still use', () => {
		const result = computeStorageRecommendation({
			disk: disk(1000, 500, 'C:\\'),
			otherServers: [
				// 50 GB limit, 20 used -> 30 reserved. Same drive, different case and separator.
				{ mountPoint: 'c:', storageLimitGb: 50, backupsBytes: 20 * GB },
				// Already over its limit -> reserves nothing.
				{ mountPoint: 'C:\\', storageLimitGb: 10, backupsBytes: 15 * GB },
				// Another drive -> ignored.
				{ mountPoint: 'D:\\', storageLimitGb: 200, backupsBytes: 0 },
			],
		});
		expect(result.reservedBytes).toBe(30 * GB);
		// budget = 500 - 30 - 100 = 370, 30% = 111 -> 110.
		expect(result.recommendedGb).toBe(110);
		// The slider max ignores reservations.
		expect(result.sliderMaxGb).toBe(400);
	});

	it('reserves only the new default for the legacy 200 GB limit', () => {
		const result = computeStorageRecommendation({
			disk: disk(1000, 500, 'C:\\'),
			otherServers: [
				// Legacy default: 50 GB default - 10 GB used.
				{ mountPoint: 'C:\\', storageLimitGb: 200, backupsBytes: 10 * GB },
				// Any other limit is reserved in full: 150 - 0.
				{ mountPoint: 'C:\\', storageLimitGb: 150, backupsBytes: 0 },
			],
		});
		expect(result.reservedBytes).toBe(190 * GB);
	});

	it("counts this server's existing backups as available to it", () => {
		const result = computeStorageRecommendation({
			disk: disk(1000, 500),
			otherServers: [],
			ownBackupsBytes: 100 * GB,
		});
		// available = 600, budget = 500, 30% = 150.
		expect(result.recommendedGb).toBe(150);
		expect(result.sliderMaxGb).toBe(500);
	});
});

describe('isSameMountPoint', () => {
	it('ignores case and trailing separators on Windows drives', () => {
		expect(isSameMountPoint('C:\\', 'c:')).toBe(true);
		expect(isSameMountPoint('C:\\', 'D:\\')).toBe(false);
	});

	it('is case-sensitive for Unix mount points', () => {
		expect(isSameMountPoint('/', '/')).toBe(true);
		expect(isSameMountPoint('/home/', '/home')).toBe(true);
		expect(isSameMountPoint('/Data', '/data')).toBe(false);
		expect(isSameMountPoint('/', '/home')).toBe(false);
	});
});

describe('formatDriveLabel', () => {
	it('shortens Windows drive roots', () => {
		expect(formatDriveLabel('c:\\')).toBe('C:');
		expect(formatDriveLabel('D:')).toBe('D:');
	});

	it('keeps Unix mount paths', () => {
		expect(formatDriveLabel('/')).toBe('/');
		expect(formatDriveLabel('/mnt/games')).toBe('/mnt/games');
	});
});
