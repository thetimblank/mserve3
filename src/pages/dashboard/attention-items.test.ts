import { describe, expect, it } from 'vitest';

import type { Server } from '@/data/servers';
import { buildCreatedServer } from '@/lib/mserve-server-mapper';
import { createDefaultServerSetupForm } from '@/lib/mserve-sync';

import { buildAttentionItems, STALE_BACKUP_MS } from './attention-items';

const NOW = new Date('2026-06-01T12:00:00Z').getTime();

const makeServer = (id: string, over: Partial<Server> = {}): Server => ({
	...buildCreatedServer(createDefaultServerSetupForm(), { id, file: 'server.jar', directory: `C:/servers/${id}` }),
	name: id,
	...over,
});

const world = { file: 'world', activated: true };
const backupAt = (time: number): Server['backups'][number] => ({
	directory: `C:/servers/x/.backups/${time}`,
	created_at: new Date(time),
	size: 1024,
	reason: 'manual',
});

const build = (servers: Server[], extra: Partial<Parameters<typeof buildAttentionItems>[0]> = {}) =>
	buildAttentionItems({ servers, securityCriticals: new Map(), now: NOW, ...extra });

describe('buildAttentionItems', () => {
	it('returns nothing for healthy servers', () => {
		const server = makeServer('ok', { worlds: [world], backups: [backupAt(NOW - 1000)] });
		expect(build([server])).toEqual([]);
	});

	it('flags missing and stale backups only for servers with worlds', () => {
		const items = build([
			makeServer('proxy'),
			makeServer('fresh', { worlds: [world] }),
			makeServer('old', { worlds: [world], backups: [backupAt(NOW - STALE_BACKUP_MS - 1)] }),
		]);
		expect(items.map((item) => item.id)).toEqual(['no-backup-fresh', 'stale-backup-old']);
	});

	it('flags backups that take more than half of the footprint', () => {
		const server = makeServer('big', { worlds: [world], backups: [backupAt(NOW)] });
		const storage = {
			byDirectory: new Map([
				[server.directory, { directory: server.directory, totalBytes: 100, worldsBytes: 30, backupsBytes: 60 }],
			]),
		};
		const [item] = build([server], { storage });
		expect(item.kind).toBe('backup-bloat');
		expect(item.severity).toBe('warning');
	});

	it('orders critical before warning before info, keeping rule order within a severity', () => {
		const sleepy = makeServer('sleepy', { status: 'sleeping' });
		const nobackup = makeServer('nobackup', { worlds: [world] });
		const insecure = makeServer('insecure');
		const crashed = makeServer('crashed', { status: 'crashed' });

		const items = build([sleepy, nobackup, insecure, crashed], {
			securityCriticals: new Map([[insecure.directory, 2]]),
		});

		expect(items.map((item) => [item.kind, item.severity])).toEqual([
			['crashed', 'critical'],
			['security', 'critical'],
			['no-backup', 'warning'],
			['sleeping', 'info'],
		]);
	});

	it('writes copy without em dashes', () => {
		const items = build([
			makeServer('a', { status: 'crashed', worlds: [world] }),
			makeServer('b', { status: 'sleeping' }),
		]);
		for (const item of items) expect(item.text).not.toContain('\u2014');
	});
});
