import { describe, expect, it, vi } from 'vitest';
import { invokeMock } from '@/test/tauri-mock';
import { createProvider } from '@/lib/server-provider';
import type { JavaRuntimeInfo } from '@/lib/java-runtime-service';
import {
	createStartRecovery,
	noteRecoveryOnline,
	noteRecoveryOutput,
	recoverFromBootCrash,
	type RecoveryEnvironment,
} from './server-start-recovery';

const runtime = (majorVersion: number): JavaRuntimeInfo =>
	({ executablePath: `C:/jdk${majorVersion}/bin/java.exe`, majorVersion, version: `${majorVersion}`, source: 'path' }) as JavaRuntimeInfo;

const server = (over: { java_installation?: string; custom_flags?: string[] } = {}) => ({
	id: 'srv',
	directory: 'C:/servers/srv',
	provider: createProvider('paper', { minecraft_version: '1.21', provider_version: '1' }),
	java_installation: '',
	custom_flags: ['--nogui'],
	...over,
});

const env = (over: Partial<RecoveryEnvironment> = {}): RecoveryEnvironment => ({
	globalDefault: '',
	runtimes: [runtime(21), runtime(25)],
	ensureJava: vi.fn(async () => null),
	updateServer: vi.fn(),
	report: vi.fn(),
	...over,
});

describe('server start recovery', () => {
	it('strips an unsupported --nogui once and retries with the same Java', async () => {
		const recovery = createStartRecovery('C:/jdk21/bin/java.exe', 21);
		const target = server();
		const environment = env();
		noteRecoveryOutput(recovery, target, 'Unrecognized option: --nogui');

		const first = await recoverFromBootCrash(recovery, target, environment);
		expect(first).toEqual({ kind: 'retry', executablePath: 'C:/jdk21/bin/java.exe' });
		expect(invokeMock).toHaveBeenCalledWith('set_server_custom_flags', {
			directory: 'C:/servers/srv',
			customFlags: [],
		});
		expect(environment.updateServer).toHaveBeenCalledWith('srv', { custom_flags: [] });

		noteRecoveryOutput(recovery, target, 'Unrecognized option: --nogui');
		expect(await recoverFromBootCrash(recovery, target, environment)).toEqual({ kind: 'none' });
	});

	it('steps down to the next installed Java and pins it once the server comes up', async () => {
		const recovery = createStartRecovery('C:/jdk21/bin/java.exe', 21);
		const target = server({ custom_flags: [] });
		noteRecoveryOutput(recovery, target, 'java.lang.UnsupportedClassVersionError: class file version 69.0');

		const outcome = await recoverFromBootCrash(recovery, target, env());
		expect(outcome).toEqual({ kind: 'retry', executablePath: 'C:/jdk25/bin/java.exe' });
		expect(noteRecoveryOnline(recovery, target)).toBe('C:/jdk25/bin/java.exe');
	});

	it('offers the download once when no installed Java is left, then gives up', async () => {
		const recovery = createStartRecovery('C:/jdk21/bin/java.exe', 21);
		const target = server({ custom_flags: [] });
		const environment = env({ runtimes: [runtime(21)] });
		noteRecoveryOutput(recovery, target, 'java.lang.UnsupportedClassVersionError: class file version 69.0');

		const outcome = await recoverFromBootCrash(recovery, target, environment);
		expect(environment.ensureJava).toHaveBeenCalledTimes(1);
		expect(outcome.kind).toBe('failed');
	});

	it('never steps down a pinned Java', async () => {
		const recovery = createStartRecovery('C:/jdk21/bin/java.exe', 21);
		const target = server({ custom_flags: [], java_installation: 'C:/jdk21/bin/java.exe' });
		noteRecoveryOutput(recovery, target, 'java.lang.UnsupportedClassVersionError: class file version 69.0');
		expect(await recoverFromBootCrash(recovery, target, env())).toEqual({ kind: 'none' });
	});

	it('leaves a server that came up alone', async () => {
		const recovery = createStartRecovery('C:/jdk21/bin/java.exe', 21);
		const target = server();
		noteRecoveryOnline(recovery, target);
		noteRecoveryOutput(recovery, target, 'Unrecognized option: --nogui');
		expect(await recoverFromBootCrash(recovery, target, env())).toEqual({ kind: 'none' });
	});
});
