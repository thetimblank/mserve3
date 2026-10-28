import * as TOML from '@iarna/toml';
import { describe, expect, it } from 'vitest';
import { patchTomlText } from './toml-patch';

const VELOCITY_TOML = `# Config version. Do not change this
config-version = "2.7"

# What port should the proxy be bound to? By default, we'll bind to all addresses on port 25565.
bind = "0.0.0.0:25565"

# What should be the MOTD? # signs inside strings stay put
motd = "<#09add3>A # Velocity Server" # trailing note

online-mode = true

[servers]
# Configure your servers here.
lobby = "127.0.0.1:30066"
factions = "127.0.0.1:30067"

# In what order we should try servers when a player logs in or is kicked from a server.
try = [
    "lobby"
]

[forced-hosts]
# Configure your forced hosts here.
"lobby.example.com" = [
    "lobby"
]

[advanced]
# How large a Minecraft packet has to be before we compress it.
compression-threshold = 256
`;

const edit = (mutate: (root: Record<string, unknown>) => void) => {
	const root = JSON.parse(JSON.stringify(TOML.parse(VELOCITY_TOML))) as Record<string, unknown>;
	mutate(root);
	return root;
};

describe('patchTomlText', () => {
	it('returns the document untouched when nothing changed', () => {
		expect(patchTomlText(VELOCITY_TOML, edit(() => {}))).toBe(VELOCITY_TOML);
	});

	it('rewrites only the changed lines and keeps every comment', () => {
		const next = edit((root) => {
			root.bind = '0.0.0.0:25577';
			root.motd = 'Hello';
			(root.servers as Record<string, unknown>).try = ['factions', 'lobby'];
			(root.advanced as Record<string, unknown>)['compression-threshold'] = -1;
		});
		const patched = patchTomlText(VELOCITY_TOML, next);

		expect(patched).not.toBeNull();
		expect(TOML.parse(patched as string)).toEqual(TOML.parse(TOML.stringify(next as TOML.JsonMap)));
		expect(patched).toContain('bind = "0.0.0.0:25577"');
		expect(patched).toContain('motd = "Hello" # trailing note');
		expect(patched).toContain('try = [ "factions", "lobby" ]');
		expect(patched).toContain('compression-threshold = -1');
		for (const comment of VELOCITY_TOML.split('\n').filter((line) => line.startsWith('#'))) {
			expect(patched).toContain(comment);
		}
	});

	it('adds and removes keys inside a table', () => {
		const next = edit((root) => {
			const servers = root.servers as Record<string, unknown>;
			delete servers.factions;
			servers.survival = '127.0.0.1:30068';
		});
		const patched = patchTomlText(VELOCITY_TOML, next) as string;

		expect(TOML.parse(patched)).toEqual(TOML.parse(TOML.stringify(next as TOML.JsonMap)));
		expect(patched).not.toContain('factions');
		expect(patched).toContain('# Configure your servers here.');
	});

	it('adds a new root key before the first table', () => {
		const next = edit((root) => {
			root['forwarding-secret-file'] = 'forwarding.secret';
		});
		const patched = patchTomlText(VELOCITY_TOML, next) as string;

		expect(patched.indexOf('forwarding-secret-file')).toBeLessThan(patched.indexOf('[servers]'));
		expect(TOML.parse(patched)).toEqual(TOML.parse(TOML.stringify(next as TOML.JsonMap)));
	});

	it('puts the first root key above the comment that belongs to the first table', () => {
		const original = '# Configure your servers here\n[servers]\nlobby = "127.0.0.1:30066"\n';
		const patched = patchTomlText(original, { bind: '0.0.0.0:25577', servers: { lobby: '127.0.0.1:30066' } });

		expect(patched).toBe(
			'bind = "0.0.0.0:25577"\n# Configure your servers here\n[servers]\nlobby = "127.0.0.1:30066"\n',
		);
	});

	it('gives up on edits it cannot place, so the caller rewrites the file', () => {
		expect(
			patchTomlText(
				VELOCITY_TOML,
				edit((root) => {
					root.query = { enabled: false };
				}),
			),
		).toBeNull();
		expect(patchTomlText('not = [valid', {})).toBeNull();
	});
});
