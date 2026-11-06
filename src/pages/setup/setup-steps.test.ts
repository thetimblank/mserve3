import { describe, expect, it } from 'vitest';
import { FIRST_BRANCH_STEP_INDEX, isValidPort, resolveSetupSteps } from './setup-steps';

describe('resolveSetupSteps', () => {
	it('shows only the intro and the choice until a path is picked', () => {
		expect(resolveSetupSteps(null)).toEqual(['intro', 'choose']);
	});

	it('starts each branch right after the choice slide', () => {
		const tunnel = resolveSetupSteps('tunnel');
		const forward = resolveSetupSteps('forward');
		expect(tunnel[FIRST_BRANCH_STEP_INDEX]).toBe('tunnel-account');
		expect(forward[FIRST_BRANCH_STEP_INDEX]).toBe('forward-prereq');
	});

	it('puts the router step before the PC firewall step', () => {
		const forward = resolveSetupSteps('forward');
		expect(forward.indexOf('forward-router')).toBeLessThan(forward.indexOf('forward-firewall'));
		expect(forward.slice(-2)).toEqual(['forward-address', 'forward-start']);
	});
});

describe('isValidPort', () => {
	it.each([1, 25565, 65535])('accepts %i', (port) => expect(isValidPort(port)).toBe(true));
	it.each([0, -1, 65536, 25565.5, Number.NaN])('rejects %d', (port) => expect(isValidPort(port)).toBe(false));
});
