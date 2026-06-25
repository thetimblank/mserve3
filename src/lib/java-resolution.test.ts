import { describe, expect, it } from 'vitest';
import { resolveServerJavaExecutable, planJavaFallback } from './java-resolution';
import type { JavaRuntimeInfo } from './java-runtime-service';

const rt = (major: number, path: string): JavaRuntimeInfo => ({
	executablePath: path,
	majorVersion: major,
	version: `${major}.0.1`,
	source: 'path',
});

const runtimes = [rt(8, 'C:/jdk8/bin/java.exe'), rt(17, 'C:/jdk17/bin/java.exe'), rt(21, 'C:/jdk21/bin/java.exe')];
const runtimesWithJava25 = [...runtimes, rt(25, 'C:/jdk25/bin/java.exe')];

describe('resolveServerJavaExecutable precedence', () => {
	it('1. honors a per-server pin even if incompatible', () => {
		const res = resolveServerJavaExecutable({
			provider: { name: 'paper', minecraft_version: '1.21' },
			javaInstallation: 'C:/jdk8/bin/java.exe',
			runtimes,
		});
		expect(res.status).toBe('resolved');
		if (res.status === 'resolved') {
			expect(res.executablePath).toBe('C:/jdk8/bin/java.exe');
			expect(res.pinned).toBe(true);
			expect(res.majorVersion).toBe(8);
		}
	});

	it('2. uses a compatible global pin', () => {
		const res = resolveServerJavaExecutable({
			provider: { name: 'paper', minecraft_version: '1.21' },
			globalDefault: 'C:/jdk21/bin/java.exe',
			runtimes,
		});
		expect(res.status === 'resolved' && res.executablePath).toBe('C:/jdk21/bin/java.exe');
		expect(res.status === 'resolved' && res.pinned).toBe(true);
	});

	it('2b. skips an incompatible global pin and auto-resolves', () => {
		const res = resolveServerJavaExecutable({
			provider: { name: 'paper', minecraft_version: '1.21' }, // needs 21
			globalDefault: 'C:/jdk8/bin/java.exe',
			runtimes,
		});
		// Falls through to automatic resolution -> the compatible 21.
		expect(res.status === 'resolved' && res.executablePath).toBe('C:/jdk21/bin/java.exe');
		expect(res.status === 'resolved' && res.pinned).toBe(false);
	});

	it('3. automatic picks the best compatible runtime', () => {
		const res = resolveServerJavaExecutable({
			provider: { name: 'paper', minecraft_version: '1.20.4' }, // min 17, rec 21
			runtimes,
		});
		expect(res.status === 'resolved' && res.majorVersion).toBe(21);
	});

	it('4. falls back to newest when none are strictly compatible', () => {
		const res = resolveServerJavaExecutable({
			provider: { name: 'vanilla', minecraft_version: '26' }, // needs 25
			runtimes, // newest is 21
		});
		expect(res.status === 'resolved' && res.majorVersion).toBe(21);
	});

	it('5. missing when there are no runtimes', () => {
		const res = resolveServerJavaExecutable({
			provider: { name: 'paper', minecraft_version: '1.21' },
			runtimes: [],
		});
		expect(res.status).toBe('missing');
	});

	it('excludeMajors removes attempted versions (start-failure fallback)', () => {
		const res = resolveServerJavaExecutable({
			provider: { name: 'paper', minecraft_version: '1.20.4' },
			runtimes,
			excludeMajors: [21],
		});
		expect(res.status === 'resolved' && res.majorVersion).toBe(17);
	});
});

describe('planJavaFallback', () => {
	it('retries the next compatible version below when nothing is above', () => {
		const plan = planJavaFallback({
			provider: { name: 'paper', minecraft_version: '1.20.4' },
			runtimes,
			attemptedMajors: [21],
		});
		expect(plan.kind).toBe('retry');
		if (plan.kind === 'retry') expect(plan.majorVersion).toBe(17);
	});

	it('tries a higher version before going below when one is available', () => {
		const plan = planJavaFallback({
			provider: { name: 'paper', minecraft_version: '1.20.4' },
			runtimes: runtimesWithJava25,
			attemptedMajors: [21],
		});
		expect(plan.kind).toBe('retry');
		if (plan.kind === 'retry') expect(plan.majorVersion).toBe(25);
	});

	it('continues sweeping down after higher versions are exhausted', () => {
		const plan = planJavaFallback({
			provider: { name: 'paper', minecraft_version: '1.20.4' },
			runtimes: runtimesWithJava25,
			attemptedMajors: [21, 25],
		});
		expect(plan.kind).toBe('retry');
		if (plan.kind === 'retry') expect(plan.majorVersion).toBe(17);
	});

	it('reports missing once every installed runtime has been attempted', () => {
		// Only one runtime exists and it was already tried -> nothing left to step to.
		const plan = planJavaFallback({
			provider: { name: 'paper', minecraft_version: '1.21' },
			runtimes: [rt(21, 'C:/jdk21/bin/java.exe')],
			attemptedMajors: [21],
		});
		expect(plan.kind).toBe('missing');
	});

	it('reports missing when there are no runtimes', () => {
		const plan = planJavaFallback({
			provider: { name: 'paper', minecraft_version: '1.21' },
			runtimes: [],
			attemptedMajors: [],
		});
		expect(plan.kind).toBe('missing');
	});
});
