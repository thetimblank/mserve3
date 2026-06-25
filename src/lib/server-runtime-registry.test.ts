import { afterEach, describe, expect, it } from 'vitest';
import { claimServerRuntime, releaseServerRuntime, isServerRuntimeClaimed } from './server-runtime-registry';

afterEach(() => {
	// Module state is global — release anything a test claimed.
	releaseServerRuntime('a');
	releaseServerRuntime('b');
});

describe('server runtime claim/release registry', () => {
	it('claims and releases a server id', () => {
		expect(isServerRuntimeClaimed('a')).toBe(false);
		claimServerRuntime('a');
		expect(isServerRuntimeClaimed('a')).toBe(true);
		releaseServerRuntime('a');
		expect(isServerRuntimeClaimed('a')).toBe(false);
	});

	it('tracks ids independently', () => {
		claimServerRuntime('a');
		expect(isServerRuntimeClaimed('b')).toBe(false);
		claimServerRuntime('b');
		expect(isServerRuntimeClaimed('a')).toBe(true);
		expect(isServerRuntimeClaimed('b')).toBe(true);
	});
});
