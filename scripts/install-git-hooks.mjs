// Points git at the repo's committed hooks (.githooks/) so the pre-push test
// gate is active for everyone after `npm install`. Idempotent and best-effort:
// it never fails the install (e.g. when run outside a git checkout or in CI).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
	if (!existsSync(path.join(repoRoot, '.git'))) {
		// Not a git checkout (tarball/CI export) — nothing to wire up.
		process.exit(0);
	}
	execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
		cwd: repoRoot,
		stdio: 'ignore',
	});
	console.log('[mserve] git hooks installed (core.hooksPath -> .githooks)');
} catch {
	// Never block `npm install` on hook setup.
	console.warn('[mserve] skipped git hook install (git unavailable)');
}
