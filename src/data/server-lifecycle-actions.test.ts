import { describe, expect, it } from 'vitest';
import {
	canForceKillStatus,
	canRestartStatus,
	canSleepServer,
	canStartStatus,
	canStopStatus,
	forceKillActionLabel,
	startActionLabel,
	stopActionLabel,
	type ServerStatus,
} from '@/data/servers';
import { createProvider } from '@/lib/server-provider';

const ALL_STATUSES: ServerStatus[] = ['offline', 'crashed', 'sleeping', 'starting', 'online', 'closing'];

const statusesWhere = (predicate: (status: ServerStatus) => boolean) => ALL_STATUSES.filter(predicate);

describe('lifecycle action gating', () => {
	it('start is offered from stopped states and from sleeping (as wake)', () => {
		expect(statusesWhere(canStartStatus)).toEqual(['offline', 'crashed', 'sleeping']);
	});

	it('stop is offered for live processes and for sleeping wake listeners', () => {
		expect(statusesWhere(canStopStatus)).toEqual(['sleeping', 'starting', 'online']);
	});

	it('restart needs a live process', () => {
		expect(statusesWhere(canRestartStatus)).toEqual(['starting', 'online']);
	});

	it('force kill is offered for anything that is not already stopped', () => {
		expect(statusesWhere(canForceKillStatus)).toEqual(['sleeping', 'starting', 'online', 'closing']);
	});
});

describe('canSleepServer', () => {
	const server = (status: ServerStatus, provider: 'paper' | 'velocity') => ({
		status,
		provider: createProvider(provider),
	});

	it('only allows sleep for a fully online gameplay server', () => {
		expect(canSleepServer(server('online', 'paper'))).toBe(true);
		// `starting` is rejected by the backend — the button must not appear yet.
		expect(canSleepServer(server('starting', 'paper'))).toBe(false);
		expect(canSleepServer(server('sleeping', 'paper'))).toBe(false);
		expect(canSleepServer(server('offline', 'paper'))).toBe(false);
		expect(canSleepServer(server('crashed', 'paper'))).toBe(false);
	});

	it('never allows sleep for a proxy provider', () => {
		expect(canSleepServer(server('online', 'velocity'))).toBe(false);
	});
});

describe('action labels', () => {
	it('switches wording while sleeping', () => {
		expect(startActionLabel('sleeping')).toBe('Awake');
		expect(startActionLabel('offline')).toBe('Serve');
		expect(stopActionLabel('sleeping')).toBe('Stop sleeping');
		expect(stopActionLabel('online')).toBe('Stop');
		expect(forceKillActionLabel('sleeping')).toBe('Shutdown');
		expect(forceKillActionLabel('online')).toBe('Force Kill');
	});
});
