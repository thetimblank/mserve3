/**
 * The engine that turns a {@link ManagedNetwork} into concrete config-file
 * edits and writes them. It reuses the app's existing config parsers/serializers
 * and Tauri file commands so the network system stays consistent with the
 * standalone config editors.
 */
import { invoke } from '@tauri-apps/api/core';
import * as TOML from '@iarna/toml';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { readManagedConfigFile, writeManagedConfigFile } from '@/components/server-config-file-editor/file-operations';
import { parsePropertiesMap, serializePropertiesMap } from '@/components/server-config-file-editor/properties-config';
import { resolveProviderKind } from '@/lib/server-provider-capabilities';
import type { Server } from '@/data/servers';
import {
	buildNetworkAliasMap,
	FORWARDING_SECRET_FILE,
	getProxyBind,
	PAPER_GLOBAL_CONFIG_RELATIVE,
	type ManagedNetwork,
	type NetworkMember,
} from '@/lib/network-schema';

// --- Tauri command wrappers -------------------------------------------------

interface NetworksConfigContent {
	content: string | null;
}

interface ServerNetworkFileContent {
	relative: string;
	exists: boolean;
	content: string | null;
}

export const readNetworksConfig = (rootPath: string) =>
	invoke<NetworksConfigContent>('read_networks_config', { payload: { rootPath } });

export const writeNetworksConfig = (rootPath: string, content: string) =>
	invoke<NetworksConfigContent>('write_networks_config', { payload: { rootPath, content } });

const readServerNetworkFile = (directory: string, relative: string) =>
	invoke<ServerNetworkFileContent>('read_server_network_file', { payload: { directory, relative } });

const writeServerNetworkFile = (directory: string, relative: string, content: string) =>
	invoke<ServerNetworkFileContent>('write_server_network_file', { payload: { directory, relative, content } });

/** Read a managed config file, returning null when it does not exist yet. */
const readOptionalManagedFile = async (directory: string, fileName: string): Promise<string | null> => {
	try {
		const result = await readManagedConfigFile(directory, fileName);
		return result.content;
	} catch {
		return null;
	}
};

// --- Plan / change types ----------------------------------------------------

export type NetworkFileMethod = 'managed' | 'network';

export interface NetworkFileChange {
	serverId: string;
	serverName: string;
	directory: string;
	/** File name (managed) or relative path (network). */
	target: string;
	label: string;
	method: NetworkFileMethod;
	before: string | null;
	after: string;
	summary: string[];
}

export interface NetworkApplyPlan {
	changes: NetworkFileChange[];
}

export type NetworkDiagnosticLevel = 'error' | 'warning';

export interface NetworkDiagnostic {
	level: NetworkDiagnosticLevel;
	message: string;
	serverId?: string;
}

// --- Helpers ----------------------------------------------------------------

const isLoopbackHost = (host: string): boolean => {
	const value = host.trim().toLowerCase();
	return value === '127.0.0.1' || value === 'localhost' || value === '::1';
};

const serverMapById = (servers: Server[]) => new Map(servers.map((server) => [server.id, server]));

// --- Per-file builders ------------------------------------------------------

const buildBackendPropertiesChange = (
	server: Server,
	member: NetworkMember,
	existing: string | null,
): NetworkFileChange | null => {
	const map = existing ? parsePropertiesMap(existing) : new Map<string, string>();
	const summary: string[] = [];

	const setProp = (key: string, value: string, describe: string) => {
		if ((map.get(key) ?? '') !== value) {
			summary.push(describe);
		}
		map.set(key, value);
	};

	setProp('server-port', String(member.port), `server-port → ${member.port}`);
	setProp('online-mode', 'false', 'online-mode → false (proxy handles authentication)');

	// Harden the bind address only for loopback backends; otherwise leave it open
	// so a remotely-hosted backend keeps accepting the proxy connection.
	if (isLoopbackHost(member.host)) {
		setProp('server-ip', member.host, `server-ip → ${member.host}`);
	}

	const featuredOrder = ['server-port', 'server-ip', 'online-mode'];
	const after = serializePropertiesMap(map, featuredOrder);

	if (existing !== null && after === existing) return null;

	return {
		serverId: server.id,
		serverName: server.name,
		directory: server.directory,
		target: 'server.properties',
		label: 'server.properties',
		method: 'managed',
		before: existing,
		after,
		summary: summary.length ? summary : ['No changes'],
	};
};

const buildPaperGlobalChange = (
	server: Server,
	secret: string,
	existing: string | null,
): NetworkFileChange | null => {
	const parsed = existing ? (parseYaml(existing) as Record<string, unknown> | null) : null;
	const root: Record<string, unknown> = parsed && typeof parsed === 'object' ? { ...parsed } : {};

	const proxies = (root.proxies && typeof root.proxies === 'object' ? { ...(root.proxies as object) } : {}) as Record<
		string,
		unknown
	>;
	const velocity = (
		proxies.velocity && typeof proxies.velocity === 'object' ? { ...(proxies.velocity as object) } : {}
	) as Record<string, unknown>;

	const summary: string[] = [];
	if (velocity.enabled !== true) summary.push('proxies.velocity.enabled → true');
	if (velocity['online-mode'] !== true) summary.push('proxies.velocity.online-mode → true');
	if (velocity.secret !== secret) summary.push('proxies.velocity.secret → (synced forwarding secret)');

	velocity.enabled = true;
	velocity['online-mode'] = true;
	velocity.secret = secret;
	proxies.velocity = velocity;
	root.proxies = proxies;

	const after = stringifyYaml(root);
	if (existing !== null && after === existing) return null;

	return {
		serverId: server.id,
		serverName: server.name,
		directory: server.directory,
		target: PAPER_GLOBAL_CONFIG_RELATIVE,
		label: 'config/paper-global.yml',
		method: 'network',
		before: existing,
		after,
		summary: summary.length ? summary : ['No changes'],
	};
};

const buildVelocityChange = (
	proxy: Server,
	network: ManagedNetwork,
	members: { member: NetworkMember; server: Server }[],
	aliasMap: Map<string, string>,
	existing: string | null,
): NetworkFileChange | null => {
	const parsedRoot = existing ? (TOML.parse(existing) as Record<string, unknown>) : {};
	const root: Record<string, unknown> = { ...parsedRoot };
	const summary: string[] = [];

	// `bind` is network-managed (derived from the base port); force it.
	const bind = getProxyBind(network);
	if (root.bind !== bind) {
		root.bind = bind;
		summary.push(`bind → ${bind}`);
	}
	if (root['online-mode'] !== true) {
		root['online-mode'] = true;
		summary.push('online-mode → true');
	}
	if (root['player-info-forwarding-mode'] !== 'modern') {
		root['player-info-forwarding-mode'] = 'modern';
		summary.push('player-info-forwarding-mode → modern');
	}
	if (root['forwarding-secret-file'] !== FORWARDING_SECRET_FILE) {
		root['forwarding-secret-file'] = FORWARDING_SECRET_FILE;
		summary.push(`forwarding-secret-file → ${FORWARDING_SECRET_FILE}`);
	}

	const servers = (root.servers && typeof root.servers === 'object' ? { ...(root.servers as object) } : {}) as Record<
		string,
		unknown
	>;

	const aliasFor = (member: NetworkMember) => aliasMap.get(member.serverId) ?? member.serverId;

	for (const { member } of members) {
		const alias = aliasFor(member);
		const address = `${member.host}:${member.port}`;
		if (servers[alias] !== address) {
			summary.push(`servers.${alias} → ${address}`);
		}
		servers[alias] = address;
	}

	const tryOrder = members
		.filter(({ member }) => member.inTry)
		.sort((left, right) => left.member.tryIndex - right.member.tryIndex)
		.map(({ member }) => aliasFor(member));
	servers.try = tryOrder;
	summary.push(`try → [${tryOrder.join(', ')}]`);

	root.servers = servers;

	const after = `${TOML.stringify(root as TOML.JsonMap).trimEnd()}\n`;
	if (existing !== null && after === existing) return null;

	return {
		serverId: proxy.id,
		serverName: proxy.name,
		directory: proxy.directory,
		target: 'velocity.toml',
		label: 'velocity.toml',
		method: 'managed',
		before: existing,
		after,
		summary: summary.length ? summary : ['No changes'],
	};
};

const buildForwardingSecretChange = (
	proxy: Server,
	secret: string,
	existing: string | null,
): NetworkFileChange | null => {
	const after = `${secret}\n`;
	if (existing !== null && existing.trim() === secret) return null;

	return {
		serverId: proxy.id,
		serverName: proxy.name,
		directory: proxy.directory,
		target: FORWARDING_SECRET_FILE,
		label: 'forwarding.secret',
		method: 'network',
		before: existing,
		after,
		summary: [existing === null ? 'Create forwarding.secret' : 'Update forwarding.secret'],
	};
};

// --- Public API -------------------------------------------------------------

/**
 * Compute every config-file edit needed to realize `network` on disk. Reads the
 * current files so the review UI can show before/after. Throws if there is no
 * usable proxy.
 */
export const planNetworkApply = async (
	network: ManagedNetwork,
	servers: Server[],
): Promise<NetworkApplyPlan> => {
	const byId = serverMapById(servers);
	const proxy = network.proxyServerId ? byId.get(network.proxyServerId) : undefined;
	if (!proxy) {
		throw new Error('Assign a proxy server to this network before applying.');
	}
	if (resolveProviderKind(proxy.provider) !== 'proxy') {
		throw new Error(`${proxy.name} is not a proxy server.`);
	}

	const resolvedMembers = network.members
		.map((member) => ({ member, server: byId.get(member.serverId) }))
		.filter((entry): entry is { member: NetworkMember; server: Server } => Boolean(entry.server));

	const aliasMap = buildNetworkAliasMap(network.members, byId);

	const changes: NetworkFileChange[] = [];

	// Backends: server.properties (+ paper-global.yml for plugin backends).
	for (const { member, server } of resolvedMembers) {
		const kind = resolveProviderKind(server.provider);
		const propsExisting = await readOptionalManagedFile(server.directory, 'server.properties');
		const propsChange = buildBackendPropertiesChange(server, member, propsExisting);
		if (propsChange) changes.push(propsChange);

		if (kind === 'plugin') {
			const paperExisting = (await readServerNetworkFile(server.directory, PAPER_GLOBAL_CONFIG_RELATIVE)).content;
			const paperChange = buildPaperGlobalChange(server, network.forwarding.secret, paperExisting);
			if (paperChange) changes.push(paperChange);
		}
	}

	// Proxy: velocity.toml + forwarding.secret.
	const velocityExisting = await readOptionalManagedFile(proxy.directory, 'velocity.toml');
	const velocityChange = buildVelocityChange(proxy, network, resolvedMembers, aliasMap, velocityExisting);
	if (velocityChange) changes.push(velocityChange);

	const secretExisting = (await readServerNetworkFile(proxy.directory, FORWARDING_SECRET_FILE)).content;
	const secretChange = buildForwardingSecretChange(proxy, network.forwarding.secret, secretExisting);
	if (secretChange) changes.push(secretChange);

	return { changes };
};

/** Write every staged change to disk. */
export const applyNetworkPlan = async (plan: NetworkApplyPlan): Promise<void> => {
	for (const change of plan.changes) {
		if (change.method === 'managed') {
			await writeManagedConfigFile(change.directory, change.target, change.after);
		} else {
			await writeServerNetworkFile(change.directory, change.target, change.after);
		}
	}
};

/**
 * Validate a network for problems the UI should surface. `errors` block apply;
 * `warnings` are advisory.
 */
export const diagnoseNetwork = (
	network: ManagedNetwork,
	servers: Server[],
	allNetworks: ManagedNetwork[] = [],
): NetworkDiagnostic[] => {
	const byId = serverMapById(servers);
	const diagnostics: NetworkDiagnostic[] = [];

	const proxy = network.proxyServerId ? byId.get(network.proxyServerId) : undefined;
	if (!network.proxyServerId) {
		diagnostics.push({ level: 'error', message: 'No proxy server assigned to this network.' });
	} else if (!proxy) {
		diagnostics.push({ level: 'error', message: 'The assigned proxy server no longer exists.' });
	} else if (resolveProviderKind(proxy.provider) !== 'proxy') {
		diagnostics.push({
			level: 'error',
			message: `${proxy.name} is not a Velocity proxy and cannot route a network.`,
			serverId: proxy.id,
		});
	} else if (proxy.status !== 'offline') {
		diagnostics.push({
			level: 'error',
			message: `${proxy.name} must be stopped before applying network changes.`,
			serverId: proxy.id,
		});
	}

	if (network.members.length === 0) {
		diagnostics.push({ level: 'warning', message: 'This network has no backend servers yet.' });
	}

	const seenPorts = new Set<number>();
	for (const member of network.members) {
		const server = byId.get(member.serverId);
		if (!server) {
			diagnostics.push({
				level: 'error',
				message: 'A member server no longer exists and should be removed.',
				serverId: member.serverId,
			});
			continue;
		}

		if (server.status !== 'offline') {
			diagnostics.push({
				level: 'error',
				message: `${server.name} must be stopped before applying network changes.`,
				serverId: server.id,
			});
		}

		const kind = resolveProviderKind(server.provider);
		if (kind !== 'plugin') {
			diagnostics.push({
				level: 'warning',
				message: `${server.name} is ${kind}; Velocity modern forwarding needs a Paper/Folia backend. It will be wired but auth forwarding cannot be configured automatically.`,
				serverId: server.id,
			});
		}

		if (seenPorts.has(member.port)) {
			diagnostics.push({
				level: 'error',
				message: `Port ${member.port} is assigned to more than one backend.`,
				serverId: server.id,
			});
		}
		seenPorts.add(member.port);

		const otherNetwork = allNetworks.find(
			(candidate) =>
				candidate.id !== network.id &&
				candidate.members.some((other) => other.serverId === member.serverId),
		);
		if (otherNetwork) {
			diagnostics.push({
				level: 'warning',
				message: `${server.name} is also a member of "${otherNetwork.name}".`,
				serverId: server.id,
			});
		}
	}

	return diagnostics;
};

export const networkHasBlockingErrors = (diagnostics: NetworkDiagnostic[]): boolean =>
	diagnostics.some((diagnostic) => diagnostic.level === 'error');
