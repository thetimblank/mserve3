import { readManagedConfigFile } from '@/components/server-config-file-editor/file-operations';
import { parsePropertiesMap } from '@/components/server-config-file-editor/properties-config';
import { auditServerProperties, type SecurityFinding } from '@/lib/server-security-audit';

const readManagedFile = async (directory: string, fileName: string): Promise<string | null> => {
	try {
		const result = await readManagedConfigFile(directory, fileName);
		return result.content;
	} catch {
		// Missing/unreadable file — the audit treats these as vanilla defaults.
		return null;
	}
};

const countWhitelist = (content: string | null): number | null => {
	if (!content) return null;
	try {
		const parsed = JSON.parse(content);
		return Array.isArray(parsed) ? parsed.length : null;
	} catch {
		return null;
	}
};

/** Reads a server's server.properties and whitelist.json and runs the security audit. */
export const scanServerSecurity = async (
	server: { directory: string; ram: number },
	behindProxy: boolean,
): Promise<SecurityFinding[]> => {
	const [properties, whitelist] = await Promise.all([
		readManagedFile(server.directory, 'server.properties'),
		readManagedFile(server.directory, 'whitelist.json'),
	]);
	const props = properties ? parsePropertiesMap(properties) : new Map<string, string>();
	return auditServerProperties(props, {
		maxRamGb: Math.max(1, Number(server.ram) || 1),
		whitelistCount: countWhitelist(whitelist),
		behindProxy,
	});
};

/** Session cache of each server's critical-finding count (the dashboard's feed), keyed by directory. */
const criticalCounts = new Map<string, { behindProxy: boolean; criticals: number }>();

export const getCachedCriticalCounts = () =>
	new Map([...criticalCounts].map(([directory, entry]) => [directory, entry.criticals]));

/** Counts a server's critical findings, reusing the cached count while its network role holds. */
export const countCriticalFindings = async (
	server: { directory: string; ram: number },
	behindProxy: boolean,
): Promise<void> => {
	if (criticalCounts.get(server.directory)?.behindProxy === behindProxy) return;
	let criticals = 0;
	try {
		const findings = await scanServerSecurity(server, behindProxy);
		criticals = findings.filter((finding) => finding.severity === 'critical').length;
	} catch {}
	criticalCounts.set(server.directory, { behindProxy, criticals });
};

/** Drops a server's cached count after its security settings changed. */
export const forgetCriticalCount = (directory: string) => {
	criticalCounts.delete(directory);
};
