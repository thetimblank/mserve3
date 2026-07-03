import { describe, expect, it } from 'vitest';
import { auditServerProperties, summarizeSecurityFindings } from './server-security-audit';

const props = (entries: Record<string, string>) => new Map(Object.entries(entries));
const ctx = { maxRamGb: 4, whitelistCount: null };

const find = (findings: ReturnType<typeof auditServerProperties>, id: string) =>
	findings.find((finding) => finding.id === id);

describe('auditServerProperties', () => {
	it('flags online-mode=false as critical with a fix', () => {
		const findings = auditServerProperties(props({ 'online-mode': 'false' }), ctx);
		const finding = find(findings, 'online-mode');
		expect(finding?.severity).toBe('critical');
		expect(finding?.fix).toEqual({
			kind: 'properties',
			updates: [{ key: 'online-mode', value: 'true' }],
		});
	});

	it('passes online-mode when true or absent (vanilla default)', () => {
		expect(find(auditServerProperties(props({}), ctx), 'online-mode')?.severity).toBe('pass');
		expect(
			find(auditServerProperties(props({ 'online-mode': 'true' }), ctx), 'online-mode')?.severity,
		).toBe('pass');
	});

	it('warns when whitelist is disabled and fixes both keys', () => {
		const finding = find(auditServerProperties(props({}), ctx), 'white-list');
		expect(finding?.severity).toBe('warn');
		expect(finding?.fix).toEqual({
			kind: 'properties',
			updates: [
				{ key: 'white-list', value: 'true' },
				{ key: 'enforce-whitelist', value: 'true' },
			],
		});
	});

	it('warns when whitelist is on but not enforced', () => {
		const findings = auditServerProperties(
			props({ 'white-list': 'true', 'enforce-whitelist': 'false' }),
			ctx,
		);
		expect(find(findings, 'enforce-whitelist')?.severity).toBe('warn');
	});

	it('passes and reports the count when whitelist is fully enforced', () => {
		const findings = auditServerProperties(
			props({ 'white-list': 'true', 'enforce-whitelist': 'true' }),
			{ maxRamGb: 4, whitelistCount: 3 },
		);
		const finding = find(findings, 'white-list');
		expect(finding?.severity).toBe('pass');
		expect(finding?.explanation).toContain('3');
	});

	it('warns on rate-limit=0 with a fix to 100', () => {
		const finding = find(auditServerProperties(props({ 'rate-limit': '0' }), ctx), 'rate-limit');
		expect(finding?.severity).toBe('warn');
		expect(finding?.fix).toEqual({ kind: 'properties', updates: [{ key: 'rate-limit', value: '100' }] });
	});

	it('warns when packet compression is disabled', () => {
		const findings = auditServerProperties(props({ 'network-compression-threshold': '-1' }), ctx);
		expect(find(findings, 'network-compression-threshold')?.severity).toBe('warn');
	});

	it('only flags broadcast-rcon-to-ops when rcon is enabled', () => {
		expect(
			find(auditServerProperties(props({ 'broadcast-rcon-to-ops': 'true' }), ctx), 'broadcast-rcon-to-ops'),
		).toBeUndefined();
		const withRcon = auditServerProperties(
			props({ 'enable-rcon': 'true', 'broadcast-rcon-to-ops': 'true' }),
			ctx,
		);
		expect(find(withRcon, 'broadcast-rcon-to-ops')?.severity).toBe('warn');
	});

	it('warns on max-players that overcommits the allocated RAM', () => {
		// 4 GB → sane cap ~100; 500 is well over.
		const findings = auditServerProperties(props({ 'max-players': '500' }), { maxRamGb: 4, whitelistCount: null });
		expect(find(findings, 'max-players')?.severity).toBe('warn');
		// A reasonable value produces no finding.
		expect(find(auditServerProperties(props({ 'max-players': '20' }), ctx), 'max-players')).toBeUndefined();
	});

	it('treats enforce-secure-profile=false as a warning', () => {
		const findings = auditServerProperties(props({ 'enforce-secure-profile': 'false' }), ctx);
		expect(find(findings, 'enforce-secure-profile')?.severity).toBe('warn');
	});

	it('summarizes counts by severity', () => {
		const findings = auditServerProperties(props({ 'online-mode': 'false' }), ctx);
		const counts = summarizeSecurityFindings(findings);
		expect(counts.critical).toBeGreaterThanOrEqual(1);
		expect(counts.critical + counts.warn + counts.info + counts.pass).toBe(findings.length);
	});
});
