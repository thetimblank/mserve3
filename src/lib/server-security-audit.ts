/**
 * Pure security audit over a parsed `server.properties` map. Produces a list of
 * findings (pass/info/warn/critical) with optional one-click fixes. No IO — the
 * caller reads/writes the file — so every rule is unit-testable.
 */

export type SecuritySeverity = 'pass' | 'info' | 'warn' | 'critical';

/** A one-click remediation: either write server.properties keys or install a plugin. */
export type SecurityFix =
	| { kind: 'properties'; updates: { key: string; value: string }[] }
	| { kind: 'plugin' };

export type SecurityFinding = {
	id: string;
	severity: SecuritySeverity;
	title: string;
	explanation: string;
	fix?: SecurityFix;
};

export type SecurityAuditContext = {
	/** Allocated heap in GB, used for a max-players sanity check. */
	maxRamGb: number;
	/** Number of entries in whitelist.json, or null when unknown/unreadable. */
	whitelistCount: number | null;
};

/** Reads a property, treating a missing key as the vanilla default `fallback`. */
const read = (props: Map<string, string>, key: string, fallback: string): string => {
	const value = props.get(key);
	return value === undefined ? fallback : value.trim();
};

const isTrue = (value: string) => value.toLowerCase() === 'true';

/** Ranks findings worst-first so the summary/attention feed can surface criticals. */
export const SEVERITY_ORDER: Record<SecuritySeverity, number> = {
	critical: 0,
	warn: 1,
	info: 2,
	pass: 3,
};

/**
 * Audits a server's properties for common exposure / bot-attack risks. Vanilla
 * defaults are assumed for absent keys.
 */
export const auditServerProperties = (
	props: Map<string, string>,
	ctx: SecurityAuditContext,
): SecurityFinding[] => {
	const findings: SecurityFinding[] = [];

	// --- online-mode: the single most important setting for public servers.
	const onlineMode = read(props, 'online-mode', 'true');
	if (!isTrue(onlineMode)) {
		findings.push({
			id: 'online-mode',
			severity: 'critical',
			title: 'Online mode is off',
			explanation:
				'With online-mode=false anyone can log in as any username, including your operators. Only disable it behind a proxy that authenticates players.',
			fix: { kind: 'properties', updates: [{ key: 'online-mode', value: 'true' }] },
		});
	} else {
		findings.push({
			id: 'online-mode',
			severity: 'pass',
			title: 'Online mode is on',
			explanation: 'Players are authenticated against Mojang/Microsoft accounts.',
		});
	}

	// --- whitelist.
	const whitelist = read(props, 'white-list', 'false');
	const enforceWhitelist = read(props, 'enforce-whitelist', 'false');
	if (!isTrue(whitelist)) {
		findings.push({
			id: 'white-list',
			severity: 'warn',
			title: 'Whitelist is disabled',
			explanation:
				'A whitelist is the simplest defense against bot joins and griefers — only listed players can connect. Add players in the whitelist.json section after enabling.',
			fix: {
				kind: 'properties',
				updates: [
					{ key: 'white-list', value: 'true' },
					{ key: 'enforce-whitelist', value: 'true' },
				],
			},
		});
	} else if (!isTrue(enforceWhitelist)) {
		findings.push({
			id: 'enforce-whitelist',
			severity: 'warn',
			title: 'Whitelist is not enforced live',
			explanation:
				'enforce-whitelist=false means players removed from the whitelist stay connected until restart. Enforce it so removals kick immediately.',
			fix: { kind: 'properties', updates: [{ key: 'enforce-whitelist', value: 'true' }] },
		});
	} else {
		const count = ctx.whitelistCount;
		findings.push({
			id: 'white-list',
			severity: 'pass',
			title: 'Whitelist is enabled',
			explanation:
				count != null
					? `Only whitelisted players can join (${count} listed).`
					: 'Only whitelisted players can join.',
		});
	}

	// --- enforce-secure-profile (chat signing).
	const secureProfile = read(props, 'enforce-secure-profile', 'true');
	if (!isTrue(secureProfile)) {
		findings.push({
			id: 'enforce-secure-profile',
			severity: 'warn',
			title: 'Secure chat profiles are not enforced',
			explanation:
				'enforce-secure-profile=false lets clients connect without signed chat, which some chat-spam bots rely on. Re-enable it unless a mod requires otherwise.',
			fix: { kind: 'properties', updates: [{ key: 'enforce-secure-profile', value: 'true' }] },
		});
	}

	// --- connection rate limit.
	const rateLimit = Number(read(props, 'rate-limit', '0'));
	if (!Number.isFinite(rateLimit) || rateLimit <= 0) {
		findings.push({
			id: 'rate-limit',
			severity: 'warn',
			title: 'No packet rate limit',
			explanation:
				'rate-limit=0 disables the built-in per-connection packet cap, making the server easier to flood. A modest cap (e.g. 100) drops abusive connections.',
			fix: { kind: 'properties', updates: [{ key: 'rate-limit', value: '100' }] },
		});
	}

	// --- proxy connection guard.
	const preventProxy = read(props, 'prevent-proxy-connections', 'false');
	if (!isTrue(preventProxy)) {
		findings.push({
			id: 'prevent-proxy-connections',
			severity: 'info',
			title: 'Proxy/VPN connections are allowed',
			explanation:
				'Enabling prevent-proxy-connections blocks players whose ISP differs from their Mojang-auth country, which stops many VPN-hopping bots — but can also block legitimate VPN users. Recommended for public survival servers.',
			fix: { kind: 'properties', updates: [{ key: 'prevent-proxy-connections', value: 'true' }] },
		});
	}

	// --- spawn protection.
	const spawnProtection = Number(read(props, 'spawn-protection', '16'));
	if (Number.isFinite(spawnProtection) && spawnProtection <= 0) {
		findings.push({
			id: 'spawn-protection',
			severity: 'info',
			title: 'Spawn is not protected',
			explanation:
				'spawn-protection=0 lets non-operators build and break at spawn. A small radius (e.g. 16) protects the spawn area from griefers.',
			fix: { kind: 'properties', updates: [{ key: 'spawn-protection', value: '16' }] },
		});
	}

	// --- network compression (bandwidth amplification).
	const compression = Number(read(props, 'network-compression-threshold', '256'));
	if (Number.isFinite(compression) && compression < 0) {
		findings.push({
			id: 'network-compression-threshold',
			severity: 'warn',
			title: 'Packet compression is disabled',
			explanation:
				'network-compression-threshold=-1 turns off compression, so a flood of large packets costs more bandwidth. The default (256) is a safer choice for a public server.',
			fix: {
				kind: 'properties',
				updates: [{ key: 'network-compression-threshold', value: '256' }],
			},
		});
	}

	// --- RCON broadcast to ops.
	const broadcastRcon = read(props, 'broadcast-rcon-to-ops', 'true');
	const rconEnabled = isTrue(read(props, 'enable-rcon', 'false'));
	if (rconEnabled && isTrue(broadcastRcon)) {
		findings.push({
			id: 'broadcast-rcon-to-ops',
			severity: 'warn',
			title: 'RCON commands are broadcast to operators',
			explanation:
				'broadcast-rcon-to-ops=true echoes RCON command output to online ops, which can leak admin actions. mserve provisions this as false; imported servers may not.',
			fix: { kind: 'properties', updates: [{ key: 'broadcast-rcon-to-ops', value: 'false' }] },
		});
	}

	// --- max-players sanity vs allocated RAM (~ a player needs headroom).
	const maxPlayers = Number(read(props, 'max-players', '20'));
	const sanePlayerCap = Math.max(20, Math.round(ctx.maxRamGb * 25));
	if (Number.isFinite(maxPlayers) && maxPlayers > sanePlayerCap) {
		findings.push({
			id: 'max-players',
			severity: 'warn',
			title: 'Max players looks high for the allocated RAM',
			explanation: `max-players=${maxPlayers} may overcommit ${ctx.maxRamGb} GB of RAM. A packed server is also a bigger denial-of-service target. Consider lowering it or allocating more memory.`,
		});
	}

	return findings;
};

/** Convenience roll-up used by the section header and the dashboard attention feed. */
export const summarizeSecurityFindings = (findings: SecurityFinding[]) => {
	const counts = { critical: 0, warn: 0, info: 0, pass: 0 } as Record<SecuritySeverity, number>;
	for (const finding of findings) counts[finding.severity] += 1;
	return counts;
};
