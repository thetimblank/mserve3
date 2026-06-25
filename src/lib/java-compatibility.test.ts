import { describe, expect, it } from 'vitest';
import {
	resolveJavaRequirement,
	isJavaCompatible,
	chooseBestInstalledJava,
	evaluateJavaCompatibilityStatus,
} from './java-compatibility';

describe('resolveJavaRequirement', () => {
	it('requires Java 21 for 1.21', () => {
		const req = resolveJavaRequirement('paper', '1.21');
		expect(req.minimumMajor).toBe(21);
	});
	it('requires Java 21 for 1.20.5+', () => {
		expect(resolveJavaRequirement('paper', '1.20.5').minimumMajor).toBe(21);
	});
	it('requires Java 17 for 1.18-1.20.4', () => {
		expect(resolveJavaRequirement('paper', '1.20.4').minimumMajor).toBe(17);
		expect(resolveJavaRequirement('paper', '1.18').minimumMajor).toBe(17);
	});
	it('targets Java 8 for legacy 1.16.5', () => {
		expect(resolveJavaRequirement('paper', '1.16.5').minimumMajor).toBe(8);
	});
	it('handles modern year-based versions (26+) as Java 25', () => {
		expect(resolveJavaRequirement('vanilla', '26').minimumMajor).toBe(25);
	});
	it('uses provider rules for velocity regardless of version', () => {
		const req = resolveJavaRequirement('velocity', 'proxy');
		expect(req.minimumMajor).toBe(17);
		expect(req.recommendedMajor).toBe(21);
	});
});

describe('isJavaCompatible', () => {
	it('passes when major >= minimum', () => {
		const req = resolveJavaRequirement('paper', '1.21');
		expect(isJavaCompatible(21, req)).toBe(true);
		expect(isJavaCompatible(25, req)).toBe(true);
		expect(isJavaCompatible(17, req)).toBe(false);
	});
});

describe('chooseBestInstalledJava', () => {
	const req = resolveJavaRequirement('paper', '1.20.4'); // min 17, recommended 21

	it('returns the recommended-or-above when available', () => {
		expect(chooseBestInstalledJava([8, 17, 21, 25], req)).toBe(21);
	});
	it('falls back to the highest compatible below recommended', () => {
		expect(chooseBestInstalledJava([8, 17], req)).toBe(17);
	});
	it('returns null when nothing is compatible', () => {
		expect(chooseBestInstalledJava([8, 11], req)).toBeNull();
	});
	it('de-duplicates installed majors', () => {
		expect(chooseBestInstalledJava([17, 17, 17], req)).toBe(17);
	});
});

describe('evaluateJavaCompatibilityStatus', () => {
	const req = resolveJavaRequirement('paper', '1.21'); // min 21
	it('needs-upgrade with no runtimes', () => {
		expect(evaluateJavaCompatibilityStatus([], req)).toBe('needs-upgrade');
	});
	it('compatible when one satisfies the minimum', () => {
		expect(evaluateJavaCompatibilityStatus([8, 21], req)).toBe('compatible');
	});
	it('needs-upgrade when all are too old', () => {
		expect(evaluateJavaCompatibilityStatus([8, 17], req)).toBe('needs-upgrade');
	});
});
