import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TELEMETRY_POLLING } from './mserve-consts';

/**
 * The set of telemetry-poll keys is declared once per language boundary: TS in
 * `mserve-consts.ts` (`TELEMETRY_POLLING`) and Rust in `mserve_config.rs`
 * (`ALL_SUPPORTED_TELEMETRY`). A shared source isn't possible across the FFI
 * boundary, so this guards the two from silently drifting apart.
 */
describe('telemetry key parity', () => {
	it('matches the Rust ALL_SUPPORTED_TELEMETRY list', () => {
		const source = readFileSync(
			resolve(__dirname, '../../src-tauri/src/app/support/mserve_config.rs'),
			'utf8',
		);

		const match = source.match(/ALL_SUPPORTED_TELEMETRY[^=]*=\s*\[([^\]]*)\]/);
		expect(match, 'ALL_SUPPORTED_TELEMETRY array not found in mserve_config.rs').toBeTruthy();

		const rustKeys = [...(match?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);

		expect(rustKeys).toEqual([...TELEMETRY_POLLING]);
	});
});
